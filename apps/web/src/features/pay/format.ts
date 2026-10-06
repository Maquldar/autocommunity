import { FULL_TANK_L, isValidQty, lineTotal, PAY_LIMITS, type PayItemDto, type PayUnit } from '@autoc/shared';

/** "5" / "12,5" (ru) — liters keep one decimal, counts are whole. */
export function formatQty(qty: number, locale = 'ru'): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(qty);
}

/** Initials for a point without a logo: "GT Oil Service" → "GO", "RP" → "RP". */
export function pointInitials(name: string): string {
  const words = name.replace(/[«»"']/g, '').split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return words
    .slice(0, 2)
    .map((w) => w[0]!)
    .join('')
    .toUpperCase();
}

/** Parses typed liters ("12,5" → 12.5); null when empty or not a number. */
export function parseQty(text: string): number | null {
  const cleaned = text.replace(/\s/g, '').replace(',', '.');
  if (!cleaned) return null;
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return Number.NaN;
  return Number(cleaned);
}

/** The default quantity for a freshly picked item: 20 l of fuel, one of anything else. */
export const defaultQty = (unit: PayUnit) => (unit === 'l' ? 20 : 1);

/** One more / one less, clamped to the unit's range. */
export function stepQty(unit: PayUnit, qty: number, dir: 1 | -1): number {
  if (unit === 'l') return Math.min(PAY_LIMITS.litersMax, Math.max(1, Math.round(qty) + dir));
  return Math.min(PAY_LIMITS.countMax, Math.max(1, Math.round(qty) + dir));
}

export type Cart = { item: PayItemDto; qty: number } | null;

/** Client-side preview of the total (the server prices the order again; this only renders the screen). */
export function cartTotal(cart: Cart): number | null {
  if (!cart || !isValidQty(cart.item.unit, cart.qty)) return null;
  return lineTotal(cart.item.priceCoins, cart.qty);
}

export const isFullTank = (qty: number) => qty === FULL_TANK_L;

/** `pay_<uuid>`: one per checkout screen, so a retried confirm never pays twice. */
export function newPayKey(): string {
  const uuid = typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  return `pay_${uuid}`;
}

/** "20 л" / "2 шт." / "1" (services have no unit). `unitShort` is `pay.unitShort.*` already translated. */
export function qtyLabel(qty: number, unit: PayUnit | null, locale: string, unitShort: (u: 'l' | 'pcs') => string): string {
  const n = formatQty(qty, locale);
  return unit === 'l' || unit === 'pcs' ? `${n} ${unitShort(unit)}` : n;
}
