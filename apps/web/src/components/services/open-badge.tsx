'use client';

import { Clock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';

/** "Open now" (success) / "Closed" (neutral). Nothing when hours are unknown. */
export function OpenBadge({ openNow }: { openNow: boolean | null }) {
  const t = useTranslations('services.card');
  if (openNow === null) return null;
  return openNow ? (
    <Badge variant="success" size="sm">
      <Clock aria-hidden="true" />
      {t('openNow')}
    </Badge>
  ) : (
    <Badge variant="neutral" size="sm">
      <Clock aria-hidden="true" />
      {t('closed')}
    </Badge>
  );
}
