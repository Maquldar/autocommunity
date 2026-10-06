import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithIntl } from '../../../test/render';
import { payApi } from './api';
import type { NfcAdapter, NfcScanHandlers } from './nfc';
import { PayScanView } from './scan-view';

const push = vi.fn();
let search = new URLSearchParams();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn() }), useSearchParams: () => search }));

const TAG = 'AAemuo9fEPBDM5rlccI5U0';

function fakeAdapter(supported = true) {
  let handlers: NfcScanHandlers | null = null;
  const adapter: NfcAdapter = {
    supported,
    start: vi.fn(async (h: NfcScanHandlers) => {
      handlers = h;
    }),
  };
  return { adapter, tap: (tag: string) => handlers!.onTag(tag) };
}

function renderScan(adapter: NfcAdapter) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithIntl(
    <QueryClientProvider client={client}>
      <PayScanView adapter={adapter} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  push.mockReset();
  search = new URLSearchParams();
});

describe('PayScanView', () => {
  it('scans with Web NFC and opens the point when a sticker is tapped', async () => {
    vi.spyOn(payApi, 'byTag').mockResolvedValue({ serviceId: 's1', name: 'RP', category: 'fuel', address: 'пр. Райымбека, 480', logoUrl: null, items: [] });
    const { adapter, tap } = fakeAdapter();
    renderScan(adapter);
    expect(screen.getByRole('heading', { name: 'Hold your phone to the NFC tag at the counter' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('nfc-hero')).toHaveAttribute('data-state', 'scanning'));
    act(() => tap(TAG));
    expect(await screen.findByText('RP — opening the checkout…')).toBeInTheDocument();
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/pay/t/${TAG}`), { timeout: 3000 });
  });

  it('without Web NFC, falls back to the code from the sticker (a URL works too)', async () => {
    const { adapter } = fakeAdapter(false);
    renderScan(adapter);
    await waitFor(() => expect(screen.getByTestId('nfc-hero')).toHaveAttribute('data-state', 'unsupported'));
    expect(adapter.start).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId('pay-code'), { target: { value: 'nonsense' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open the checkout' }));
    expect(await screen.findByText(/isn't a payment code/)).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('pay-code'), { target: { value: `https://demo.example/pay/t/${TAG}` } });
    fireEvent.click(screen.getByRole('button', { name: 'Open the checkout' }));
    expect(push).toHaveBeenCalledWith(`/pay/t/${TAG}`);
  });

  it('?simulateTag= shows the detected state in dev (screenshots, e2e)', async () => {
    vi.spyOn(payApi, 'byTag').mockResolvedValue({ serviceId: 's1', name: 'RP', category: 'fuel', address: 'x', logoUrl: null, items: [] });
    search = new URLSearchParams(`simulateTag=${TAG}`);
    const { adapter } = fakeAdapter();
    renderScan(adapter);
    expect(screen.getByTestId('nfc-hero')).toHaveAttribute('data-state', 'detected');
    expect(adapter.start).not.toHaveBeenCalled();
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/pay/t/${TAG}`), { timeout: 3000 });
  });
});
