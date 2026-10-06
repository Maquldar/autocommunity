import { DEMO_TEST_CARD, GOOGLE_PAY_TEST, type PaymentProviderName } from '@autoc/shared';

export type CreatePaymentInput = { topupId: string; userId: string; amount: number };
export type CreatedPayment = { providerRef: string | null; checkoutUrl: string };
/** What a provider reports for a payment; `WalletService.completeTopup` applies it idempotently. */
export type PaymentOutcome = { topupId: string; status: 'succeeded' | 'declined'; cardLast4: string | null };

/**
 * Top-up adapter (API.md §9.1). A real provider (CloudPayments, Kaspi) implements `createPayment` with its
 * hosted checkout and turns its signed webhook into a `PaymentOutcome` (route reserved:
 * `POST /payments/webhook/:provider`); everything after that is provider-independent.
 */
export abstract class PaymentProvider {
  abstract readonly name: PaymentProviderName;
  abstract createPayment(input: CreatePaymentInput): Promise<CreatedPayment>;
  /**
   * Phase 10 (API.md §11): charges a Google Pay token for a point order in one step (a top-up that is
   * spent on the purchase straight away). A real provider sends the token to its gateway.
   */
  abstract chargeGooglePay(input: GooglePayChargeInput): Promise<GooglePayCharge>;
}

export type GooglePayChargeInput = { orderId: string; userId: string; amount: number; token: string };
export type GooglePayCharge = { status: 'succeeded' | 'declined'; providerRef: string };

/**
 * Google Pay TEST tokens: the example gateway returns `examplePaymentMethodToken`; DIRECT / other gateways in
 * TEST return a signed JSON envelope (`protocolVersion`, `signedMessage`). Anything else is declined.
 */
export function isGooglePayTestToken(token: string): boolean {
  if (token === GOOGLE_PAY_TEST.exampleToken) return true;
  try {
    const parsed = JSON.parse(token) as Record<string, unknown>;
    return typeof parsed.protocolVersion === 'string' && typeof parsed.signedMessage === 'string';
  } catch {
    return false;
  }
}

/** In-app demo checkout: no money moves. The test card succeeds, every other card is declined. */
export class DemoPaymentProvider extends PaymentProvider {
  readonly name = 'demo' as const;

  constructor(private readonly webOrigin: string) {
    super();
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatedPayment> {
    return { providerRef: `demo_${input.topupId}`, checkoutUrl: `${this.webOrigin}/wallet/checkout/${input.topupId}` };
  }

  /** No money moves: a Google Pay TEST-environment token succeeds, anything else is declined. */
  async chargeGooglePay(input: GooglePayChargeInput): Promise<GooglePayCharge> {
    return { status: isGooglePayTestToken(input.token) ? 'succeeded' : 'declined', providerRef: `demo_gpay_${input.orderId}` };
  }

  /** The demo "bank" decision for a normalized card number. */
  outcome(topupId: string, cardNumber: string): PaymentOutcome {
    return { topupId, status: cardNumber === DEMO_TEST_CARD ? 'succeeded' : 'declined', cardLast4: cardNumber.slice(-4) };
  }
}
