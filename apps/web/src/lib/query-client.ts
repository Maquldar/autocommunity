import { QueryClient } from '@tanstack/react-query';

/** HTTP status carried by API errors (the api client attaches it). */
function statusOf(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const { status } = error as { status: unknown };
    return typeof status === 'number' ? status : undefined;
  }
  return undefined;
}

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        // 4xx won't fix itself on retry (except 408/429); network and 5xx get two retries.
        retry: (failureCount, error) => {
          const status = statusOf(error);
          if (status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429) return false;
          return failureCount < 2;
        },
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
      },
      mutations: { retry: false },
    },
  });
}
