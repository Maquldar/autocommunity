import type { FieldPath, FieldValues, UseFormReturn } from 'react-hook-form';
import { getValidationIssues, isApiError, type ApiErrorCode } from '@/lib/api/errors';
import { SERVER_ERROR_TYPE } from './field-error';

export type ApiErrorFieldMap<T extends FieldValues> = Partial<Record<ApiErrorCode, FieldPath<T>>>;

/**
 * Shows a failed submit on the form: codes in `fieldByCode` (NICKNAME_TAKEN → nickname) and
 * server-side validation issues go to their fields; anything else goes to `root.server`.
 * Returns true when the error was attached to a field (that field is focused).
 */
export function applyApiError<T extends FieldValues>(
  form: Pick<UseFormReturn<T>, 'setError' | 'getValues'>,
  error: unknown,
  message: string,
  { fieldByCode = {}, invalidFieldMessage }: { fieldByCode?: ApiErrorFieldMap<T>; invalidFieldMessage?: string } = {},
): boolean {
  const field = isApiError(error) ? fieldByCode[error.code] : undefined;
  if (field) {
    form.setError(field, { type: SERVER_ERROR_TYPE, message }, { shouldFocus: true });
    return true;
  }
  const values = form.getValues() as Record<string, unknown>;
  const issues = getValidationIssues(error).filter((issue) => typeof issue.path[0] === 'string' && issue.path[0] in values);
  if (issues.length > 0) {
    issues.forEach((issue, index) => {
      form.setError(
        String(issue.path[0]) as FieldPath<T>,
        { type: SERVER_ERROR_TYPE, message: invalidFieldMessage ?? message },
        { shouldFocus: index === 0 },
      );
    });
    return true;
  }
  form.setError('root.server', { type: SERVER_ERROR_TYPE, message });
  return false;
}
