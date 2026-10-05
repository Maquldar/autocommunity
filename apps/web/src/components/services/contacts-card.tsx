'use client';

import type { ServiceDto } from '@autoc/shared';
import { ExternalLink, MapPin, Phone } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { formatServicePhone, mapLinks } from './format';

/** Address with "open in 2GIS / Google Maps" links and a tap-to-call phone. */
export function ContactsCard({ service }: { service: Pick<ServiceDto, 'address' | 'phone' | 'lat' | 'lng'> }) {
  const t = useTranslations('services.details');
  const links = mapLinks(service.lat, service.lng);
  const phone = service.phone ? formatServicePhone(service.phone) : null;
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">{t('address')}</h2>
        <p className="flex items-start gap-2 break-words text-[0.9375rem]">
          <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0">{service.address}</span>
        </p>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['openIn2gis', links.twoGis],
              ['openInGoogle', links.google],
            ] as const
          ).map(([key, href]) => (
            <Button key={key} asChild variant="outline" size="sm" trailingIcon={<ExternalLink aria-hidden="true" />}>
              <a href={href} target="_blank" rel="noopener noreferrer" aria-label={t('openInMapsLabel', { app: t(key) })}>
                {t(key)}
              </a>
            </Button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">{t('phone')}</h2>
        {phone ? (
          <Button asChild variant="secondary" leadingIcon={<Phone aria-hidden="true" />} className="self-start">
            <a href={`tel:${service.phone}`} aria-label={t('call', { phone })}>
              <span className="tabular-nums">{phone}</span>
            </a>
          </Button>
        ) : (
          <p className="text-[0.9375rem] text-muted-foreground">{t('noPhone')}</p>
        )}
      </div>
    </Card>
  );
}
