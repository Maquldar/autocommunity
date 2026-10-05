import type { ReactNode } from 'react';
import { toast } from 'sonner';

type Options = {
  description?: ReactNode;
  id?: string | number;
  duration?: number;
  /** Optional follow-up ("Open"). */
  action?: { label: string; onClick: () => void };
};
type RetryOptions = Options & { retry?: { label: string; onClick: () => void } };

/**
 * Thin wrapper over sonner so feature code uses one vocabulary and consistent durations.
 * Toasts confirm actions or report background failures; never put the only copy of
 * important information in a toast (it disappears).
 */
export const notify = {
  success: (message: ReactNode, options?: Options) => toast.success(message, { duration: 3000, ...options }),
  info: (message: ReactNode, options?: Options) => toast.info(message, { duration: 4000, ...options }),
  warning: (message: ReactNode, options?: Options) => toast.warning(message, { duration: 5000, ...options }),
  error: (message: ReactNode, { retry, ...options }: RetryOptions = {}) =>
    toast.error(message, {
      duration: retry ? 8000 : 6000,
      action: retry ? { label: retry.label, onClick: retry.onClick } : undefined,
      ...options,
    }),
  /** Loading → success/error for a promise. Messages are already-translated strings. */
  promise: <T>(promise: Promise<T>, messages: { loading: ReactNode; success: ReactNode; error: ReactNode }) =>
    toast.promise(promise, messages),
  dismiss: (id?: string | number) => toast.dismiss(id),
};
