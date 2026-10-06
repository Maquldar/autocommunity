import { describe, expect, it } from 'vitest';
import { isReadyToPayRequest, paymentDataRequest, resultFromPaymentData } from './google-pay';

describe('Google Pay (TEST)', () => {
  it('uses the example gateway, card networks and KZT', () => {
    const req = paymentDataRequest(1225, 'RP');
    expect(req.allowedPaymentMethods[0]!.tokenizationSpecification.parameters).toEqual({ gateway: 'example', gatewayMerchantId: 'exampleGatewayMerchantId' });
    expect(req.transactionInfo).toMatchObject({ totalPrice: '1225.00', currencyCode: 'KZT', countryCode: 'KZ', totalPriceStatus: 'FINAL' });
    expect(isReadyToPayRequest().allowedPaymentMethods[0]).not.toHaveProperty('tokenizationSpecification');
  });

  it('extracts the token and display info, dropping malformed fields', () => {
    expect(
      resultFromPaymentData({ paymentMethodData: { tokenizationData: { token: 'examplePaymentMethodToken' }, info: { cardNetwork: 'VISA', cardDetails: '1111' } } }),
    ).toEqual({ token: 'examplePaymentMethodToken', cardNetwork: 'VISA', cardDetails: '1111' });
    expect(resultFromPaymentData({ paymentMethodData: { tokenizationData: { token: 't' }, info: { cardNetwork: '<b>', cardDetails: '12' } } })).toEqual({ token: 't', cardNetwork: undefined, cardDetails: undefined });
    expect(resultFromPaymentData({})).toBeNull();
  });
});
