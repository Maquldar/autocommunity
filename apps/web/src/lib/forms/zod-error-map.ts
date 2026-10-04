'use client';

import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import type { z } from 'zod';

type Translate = ReturnType<typeof useTranslations<'form'>>;

const isEmpty = (input: unknown) => input === undefined || input === null || input === '';

/** Localized messages for zod issues that have no schema-level message (pure; tested). */
export function createZodErrorMap(t: Translate): z.core.$ZodErrorMap {
  return (issue) => {
    switch (issue.code) {
      case 'invalid_type':
        return isEmpty(issue.input) ? t('required') : t('invalid');
      case 'too_small': {
        const min = Number(issue.minimum);
        if (issue.origin === 'string') return min <= 1 ? t('required') : t('tooShort', { min });
        if (issue.origin === 'number' || issue.origin === 'int') return t('numberMin', { min });
        return t('invalid');
      }
      case 'too_big': {
        const max = Number(issue.maximum);
        if (issue.origin === 'string') return t('tooLong', { max });
        if (issue.origin === 'number' || issue.origin === 'int') return t('numberMax', { max });
        return t('invalid');
      }
      case 'invalid_value':
        return t('chooseOption');
      default:
        return t('invalid');
    }
  };
}

/**
 * Pass to `zodResolver(schema, { error })` so the shared schemas produce localized messages.
 * Checks that carry their own (English) message in @autoc/shared — e.g. the nickname regex —
 * are translated per field with `fieldErrorText`.
 */
export function useZodErrorMap(): z.core.$ZodErrorMap {
  const t = useTranslations('form');
  return useMemo(() => createZodErrorMap(t), [t]);
}
