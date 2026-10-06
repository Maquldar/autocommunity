import type { TopupDto } from '@autoc/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { renderWithIntl } from '../../../test/render';
import { walletApi, walletKeys } from './api';
import { CheckoutView } from './checkout-view';

const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace }) }));

const topup = (over: Partial<TopupDto> = {}): TopupDto => ({
  id: 't1',
  amount: 5000,
  status: 'pending',
  provider: 'demo',
  cardLast4: null,
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
  completedAt: null,
  ...over,
});

function renderCheckout(data: TopupDto) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(walletKeys.topup('t1'), data);
  return renderWithIntl(
    <QueryClientProvider client={client}>
      <CheckoutView topupId="t1" />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('CheckoutView (demo provider)', () => {
  it('shows the amount, the test-card hint, and pays with it', async () => {
    const confirm = vi.spyOn(walletApi, 'demoConfirm').mockResolvedValue(topup({ status: 'succeeded', cardLast4: '4242' }));
    renderCheckout(topup());
    expect(screen.getByTestId('checkout-amount')).toHaveTextContent('5,000 ₸');
    expect(screen.getByTestId('test-card-hint')).toHaveTextContent('Test card 4242 4242 4242 4242');
    fireEvent.click(screen.getByRole('button', { name: 'Pay 5,000 ₸' }));
    expect(screen.getByText('Enter the card number.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Use it' }));
    expect(screen.getByTestId('card-number')).toHaveValue('4242 4242 4242 4242');
    fireEvent.click(screen.getByRole('button', { name: 'Pay 5,000 ₸' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith('t1', { cardNumber: '4242424242424242', expiry: undefined, cvc: undefined }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/wallet'));
  });

  it('a declined card shows the error; a declined top-up offers a new one', async () => {
    vi.spyOn(walletApi, 'demoConfirm').mockRejectedValue(new ApiError({ status: 402, code: 'PAYMENT_DECLINED', message: '' }));
    vi.spyOn(walletApi, 'topup').mockResolvedValue(topup({ status: 'declined' }));
    renderCheckout(topup());
    fireEvent.change(screen.getByTestId('card-number'), { target: { value: '4000000000000002' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pay 5,000 ₸' }));
    await waitFor(() => expect(screen.getByTestId('checkout-outcome')).toHaveAttribute('data-kind', 'declined'));
    expect(screen.getByText('Card declined')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('a succeeded top-up shows success with a way back', () => {
    renderCheckout(topup({ status: 'succeeded' }));
    expect(screen.getByTestId('checkout-outcome')).toHaveAttribute('data-tone', 'success');
    expect(screen.getByRole('link', { name: 'Back to wallet' })).toHaveAttribute('href', '/wallet');
  });
});
