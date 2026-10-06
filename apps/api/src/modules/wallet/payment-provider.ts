import { DEMO_TEST_CARD, type PaymentProviderName } from '@autoc/shared';

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

  /** The demo "bank" decision for a normalized card number. */
  outcome(topupId: string, cardNumber: string): PaymentOutcome {
    return { topupId, status: cardNumber === DEMO_TEST_CARD ? 'succeeded' : 'declined', cardLast4: cardNumber.slice(-4) };
  }
}
