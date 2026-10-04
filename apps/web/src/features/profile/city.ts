'use client';

import { CITIES } from '@autoc/shared';
import { useTranslations } from 'next-intl';
import { useCallback } from 'react';

type City = (typeof CITIES)[number];

function isCity(value: string): value is City {
  return (CITIES as readonly string[]).includes(value);
}

/** Localized city name; unknown values (legacy data) are shown as stored. */
export function useCityName(): (city: string) => string {
  const t = useTranslations('cities');
  return useCallback((city: string) => (isCity(city) ? t(city) : city), [t]);
}
