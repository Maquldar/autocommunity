/**
 * Phase 10 — "Оплата на точке" (API.md §10): a driver pays a partner point (a gas station, an oil-change
 * service) from the app, by tapping an NFC sticker or scanning a QR code at the counter. Demo only: coins
 * are internal (SPEC §9.2) and Google Pay runs in its TEST environment, so no real money moves.
 */
import { z } from 'zod';
import { idSchema, INVISIBLE_RE, paginationQuerySchema } from './schemas';
import type { ServiceCategory } from './services';
import { idempotencyKeySchema } from './wallet';

/* ---------- limits ---------- */

export const PAY_UNITS = ['l', 'pcs', 'service'] as const;
/** `l` = liters (decimal quantity, 0.1 step); `pcs` = pieces; `service` = one job. */
export type PayUnit = (typeof PAY_UNITS)[number];

export const PAY_METHODS = ['coins', 'google_pay'] as const;
export type PayMethod = (typeof PAY_METHODS)[number];

export const PAY_LIMITS = {
  itemsPerPoint: 30,
  itemNameMin: 2,
  itemNameMax: 80,
  priceMin: 1,
  priceMax: 1_000_000,
  /** Lines in one order. */
  linesMax: 10,
  /** Liters: 0.1 step. */
  litersMin: 0.1,
  litersMax: 200,
  /** Pieces / services. */
  countMax: 20,
  /** An order total, in coins (1 coin = 1 ₸). */
  orderMin: 1,
  orderMax: 200_000,
  /** Orders created per user per minute. */
  ordersPerMinute: 10,
  /** Tag lookups per user per minute (tags are 128-bit random, this only slows scripted probing). */
  tagLookupsPerMinute: 60,
  /** `payTag`: 22 base64url characters (128 bits). Lookups accept 16–64 for future formats. */
  tagMin: 16,
  tagMax: 64,
  googlePayTokenMax: 20_000,
} as const;

/** Fuel presets in the app: 10 / 20 / 30 l and "полный бак" (counted as this many liters). */
export const FUEL_PRESETS_L = [10, 20, 30] as const;
export const FULL_TANK_L = 50;

/** Google Pay API for Web in its TEST environment with the documented example gateway. */
export const GOOGLE_PAY_TEST = {
  environment: 'TEST',
  gateway: 'example',
  gatewayMerchantId: 'exampleGatewayMerchantId',
  /** The token Google Pay returns in TEST with the example gateway. */
  exampleToken: 'examplePaymentMethodToken',
  merchantName: 'AutoCommunity (demo)',
  currencyCode: 'KZT',
  countryCode: 'KZ',
  allowedCardNetworks: ['MASTERCARD', 'VISA'],
  allowedAuthMethods: ['PAN_ONLY', 'CRYPTOGRAM_3DS'],
} as const;

/* ---------- pure helpers ---------- */

export const PAY_TAG_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** `https://<web origin>/pay/t/<payTag>` — what an NFC sticker or a counter QR code carries. */
export const payTagUrl = (webOrigin: string, tag: string) => `${webOrigin.replace(/\/+$/, '')}/pay/t/${tag}`;

/**
 * The payTag from an NFC record, a scanned QR code or typed text: a `…/pay/t/<tag>` URL (any origin, so a
 * sticker printed for the demo host still works locally) or a bare tag. Null when it isn't one.
 */
export function extractPayTag(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const m = /\/pay\/t\/([A-Za-z0-9_-]+)\/?(?:[?#].*)?$/.exec(text);
  const candidate = m ? m[1]! : text;
  return PAY_TAG_RE.test(candidate) ? candidate : null;
}

/** Quantity rule per unit: liters to 0.1, pieces and services whole. */
export function isValidQty(unit: PayUnit, qty: number): boolean {
  if (!Number.isFinite(qty) || qty <= 0) return false;
  if (unit === 'l') return qty >= PAY_LIMITS.litersMin && qty <= PAY_LIMITS.litersMax && Math.abs(qty * 10 - Math.round(qty * 10)) < 1e-9;
  return Number.isInteger(qty) && qty >= 1 && qty <= PAY_LIMITS.countMax;
}

/** One line's total in whole coins (rounded half up; liters can give fractions: 12.5 l × 245 = 3 062.5 → 3 063). */
export const lineTotal = (priceCoins: number, qty: number) => Math.round(Math.round(priceCoins * qty * 100) / 100);

/* ---------- request schemas ---------- */

const itemName = z
  .string()
  .trim()
  .min(PAY_LIMITS.itemNameMin)
  .max(PAY_LIMITS.itemNameMax)
  .refine((v) => !INVISIBLE_RE.test(v) && !/[\n\t]/.test(v), 'Contains invalid characters');

export const payItemInputSchema = z.object({
  /** Keep an existing item's id to update it in place; omit for a new item. */
  id: idSchema.optional(),
  name: itemName,
  priceCoins: z.number().int().min(PAY_LIMITS.priceMin).max(PAY_LIMITS.priceMax),
  unit: z.enum(PAY_UNITS),
});
export type PayItemInput = z.output<typeof payItemInputSchema>;

const adminNote = z.string().trim().min(3).max(500);

/** Replaces the whole price list (order = display order). Admins acting on someone else's point give a note. */
export const putPayItemsSchema = z.object({
  items: z
    .array(payItemInputSchema)
    .max(PAY_LIMITS.itemsPerPoint)
    .refine((items) => new Set(items.filter((i) => i.id).map((i) => i.id)).size === items.filter((i) => i.id).length, 'Duplicate item ids'),
  note: adminNote.optional(),
});
export type PutPayItemsInput = z.output<typeof putPayItemsSchema>;

export const adminPayPartnerSchema = z.object({
  acceptsPayments: z.boolean(),
  /** The user whose wallet receives `sale` rows; null = no owner (merchant settlement). Omit to keep. */
  ownerId: idSchema.nullable().optional(),
  note: adminNote,
});
export type AdminPayPartnerInput = z.output<typeof adminPayPartnerSchema>;

export const payTagParamSchema = z.string().regex(PAY_TAG_RE);

const qtySchema = z.number().positive().max(PAY_LIMITS.litersMax);

export const googlePayDataSchema = z.object({
  /** `paymentMethodData.tokenizationData.token` from `loadPaymentData`. */
  token: z.string().min(1).max(PAY_LIMITS.googlePayTokenMax),
  /** `paymentMethodData.info` (display only). */
  cardNetwork: z
    .string()
    .trim()
    .regex(/^[A-Z_]{2,20}$/)
    .optional(),
  cardDetails: z
    .string()
    .trim()
    .regex(/^\d{4}$/)
    .optional(),
});
export type GooglePayData = z.output<typeof googlePayDataSchema>;

/**
 * Exactly one of `items` (priced on the server) or `amount` (a free sum, e.g. "fuel for 5 000 ₸").
 * `google_pay` needs `googlePay`; `coins` must not carry it.
 */
export const createPayOrderSchema = z
  .object({
    serviceId: idSchema,
    items: z
      .array(z.object({ itemId: idSchema, qty: qtySchema }))
      .min(1)
      .max(PAY_LIMITS.linesMax)
      .refine((lines) => new Set(lines.map((l) => l.itemId)).size === lines.length, 'Each item once')
      .optional(),
    amount: z.number().int().min(PAY_LIMITS.orderMin).max(PAY_LIMITS.orderMax).optional(),
    method: z.enum(PAY_METHODS),
    googlePay: googlePayDataSchema.optional(),
    idempotencyKey: idempotencyKeySchema,
  })
  .superRefine((v, ctx) => {
    if ((v.items ? 1 : 0) + (v.amount !== undefined ? 1 : 0) !== 1) ctx.addIssue({ code: 'custom', path: ['items'], message: 'Give exactly one of items or amount' });
    if (v.method === 'google_pay' && !v.googlePay) ctx.addIssue({ code: 'custom', path: ['googlePay'], message: 'Google Pay data is required' });
    if (v.method === 'coins' && v.googlePay) ctx.addIssue({ code: 'custom', path: ['googlePay'], message: 'Only for method google_pay' });
  });
export type CreatePayOrderInput = z.output<typeof createPayOrderSchema>;

export const payOrdersQuerySchema = paginationQuerySchema;

/* ---------- DTOs ---------- */

export type PayItemDto = { id: string; name: string; priceCoins: number; unit: PayUnit };

/** What a buyer sees after resolving a point (by service id or payTag). */
export type PayPointDto = {
  serviceId: string;
  name: string;
  category: ServiceCategory;
  address: string;
  /** The service's first photo (thumbnail), else null → initials. */
  logoUrl: string | null;
  items: PayItemDto[];
};

/** For admins and the point's owner (price list editor, sticker). */
export type PayPointManageDto = PayPointDto & {
  acceptsPayments: boolean;
  ownerId: string | null;
  ownerNickname: string | null;
  /** Opaque token printed into the NFC sticker / QR code. Null until the point is first made a partner. */
  payTag: string | null;
  /** `https://<web origin>/pay/t/<payTag>`. */
  payUrl: string | null;
  canRotate: boolean;
};

export type PayLineDto = {
  /** Null for a free-amount order. */
  itemId: string | null;
  /** Snapshot at purchase time; null for a free-amount order (the UI says "Оплата по сумме"). */
  name: string | null;
  unit: PayUnit | null;
  qty: number;
  priceCoins: number;
  totalCoins: number;
};

export type PayReceiptDto = {
  orderId: string;
  point: { serviceId: string; name: string; category: ServiceCategory; address: string };
  items: PayLineDto[];
  total: number;
  method: PayMethod;
  paidAt: string;
  /** Coins left after a `coins` purchase; null for Google Pay (the coin balance isn't used). */
  balanceAfter: number | null;
  /** Google Pay TEST card shown on the receipt ("VISA •••• 1111"). */
  card: { network: string | null; last4: string | null } | null;
  /** Always true in this build: no real money moved. */
  demo: true;
};

/* ---------- notification payloads ---------- */

export type PurchasePaidPayload = { orderId: string; serviceId: string; pointName: string; total: number; method: PayMethod };
