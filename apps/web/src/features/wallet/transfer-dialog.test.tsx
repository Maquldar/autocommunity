import type { Me, PremiumDto, WalletDto } from '@autoc/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { renderWithIntl } from '../../../test/render';
import { walletApi, walletKeys } from './api';
import { IDEMPOTENCY_KEY_RE } from './format';
import { TransferDialog } from './transfer-dialog';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/lib/auth/guards', () => ({ useCurrentUser: () => ({ id: 'me' }) as Me }));

const premium: PremiumDto = {
  status: 'none',
  isPremium: false,
  autoRenew: false,
  startedAt: null,
  currentPeriodEnd: null,
  priceCoins: 1490,
  periodDays: 30,
  limits: { vehicles: 5, postMedia: 6, communitiesOwned: 10, communityMemberships: 50 },
};
const wallet: WalletDto = { balance: 5000, frozen: false, premium, transferDailyRemaining: 100_000 };
const recipient = { id: 'u2', name: 'Dana S.', nickname: 'dana', avatarUrl: null, rating: 70, isPremium: true };

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(walletKeys.wallet, wallet);
  return renderWithIntl(
    <QueryClientProvider client={client}>
      <TransferDialog open onOpenChange={vi.fn()} recipient={recipient} />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('TransferDialog', () => {
  it('validates the amount, confirms with the recipient, and reuses one idempotency key on retry', async () => {
    const transfer = vi
      .spyOn(walletApi, 'transfer')
      .mockRejectedValueOnce(new ApiError({ status: 0, code: 'NETWORK_ERROR', message: 'offline' }))
      .mockResolvedValueOnce({ transaction: {} as never, balance: 4000 });
    renderDialog();
    const dialog = screen.getByTestId('transfer-dialog');

    fireEvent.change(within(dialog).getByTestId('transfer-amount'), { target: { value: '6000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next' }));
    expect(within(dialog).getByText("That's more than your balance (5,000).")).toBeInTheDocument();

    fireEvent.change(within(dialog).getByTestId('transfer-amount'), { target: { value: '1000' } });
    fireEvent.change(within(dialog).getByTestId('transfer-message'), { target: { value: 'за помощь' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next' }));

    const confirm = within(dialog).getByTestId('transfer-confirm');
    expect(confirm).toHaveTextContent('Dana S.');
    expect(confirm).toHaveTextContent('@dana');
    expect(within(dialog).getByTestId('transfer-confirm-amount')).toHaveTextContent('1,000 coins');

    fireEvent.click(within(dialog).getByTestId('transfer-send'));
    await waitFor(() => expect(within(dialog).getByTestId('transfer-error')).toHaveTextContent('No connection to the server'));
    fireEvent.click(within(dialog).getByTestId('transfer-send'));
    await waitFor(() => expect(transfer).toHaveBeenCalledTimes(2));

    const [first, second] = transfer.mock.calls.map((c) => c[0]);
    expect(first).toMatchObject({ toUserId: 'u2', amount: 1000, message: 'за помощь' });
    expect(first!.idempotencyKey).toMatch(IDEMPOTENCY_KEY_RE);
    expect(second!.idempotencyKey).toBe(first!.idempotencyKey);
  });

  it('maps server errors to friendly text', async () => {
    vi.spyOn(walletApi, 'transfer').mockRejectedValue(new ApiError({ status: 409, code: 'TRANSFER_DAILY_CAP', message: '', details: { cap: 100000, remaining: 500 } }));
    renderDialog();
    const dialog = screen.getByTestId('transfer-dialog');
    fireEvent.change(within(dialog).getByTestId('transfer-amount'), { target: { value: '1000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next' }));
    fireEvent.click(within(dialog).getByTestId('transfer-send'));
    await waitFor(() => expect(within(dialog).getByTestId('transfer-error')).toHaveTextContent('Daily limit is 100,000 coins. Today you can send 500 more.'));
  });
});
