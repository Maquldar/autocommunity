/** Message types set by `applyApiError` (already localized). */
export const SERVER_ERROR_TYPE = 'server';

/**
 * Text for a field error. `overrides` replaces messages by zod issue code (e.g. `invalid_format`
 * for a regex whose shared-schema message is English). Server errors are shown as-is.
 */
export function fieldErrorText(
  // Structural so it also accepts RHF's error type for `unknown`-typed fields (e.g. coerced numbers).
  error: { type?: string | number; message?: string } | undefined,
  overrides?: Partial<Record<string, string>>,
): string | undefined {
  if (!error) return undefined;
  const type = String(error.type ?? '');
  if (type !== SERVER_ERROR_TYPE && overrides?.[type]) return overrides[type];
  return error.message;
}
