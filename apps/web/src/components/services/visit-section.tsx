'use client';

import type { ServiceDto, VisitMethod } from '@autoc/shared';
import { BadgeCheck, CircleX, Hourglass, MapPinCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useReducer, useRef } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { notify } from '@/lib/toast';
import { ReviewForm } from './review-form';
import { initialVisitFlow, visitFlowReducer, visitOffer } from './visit-flow';
import { VisitSheet } from './visit-sheet';

/**
 * The visit → review flow on a verified service: "I visited" (sheet with geo / QR / photo), the visit's
 * status, then the review form once the visit is verified.
 */
export function VisitSection({ service, now, initialCode }: { service: ServiceDto; now: Date; initialCode?: string | null }) {
  const t = useTranslations('services.visit');
  const [flow, dispatch] = useReducer(visitFlowReducer, initialVisitFlow);
  const offer = visitOffer(service.myVisit, now);
  const deepLinked = useRef(false);

  // Scanning the printed QR with the phone camera opens /services/{id}?code=… → straight to the QR check.
  useEffect(() => {
    if (initialCode && offer.canVisit && !deepLinked.current) {
      deepLinked.current = true;
      dispatch({ type: 'open', method: 'qr', code: initialCode });
    }
  }, [initialCode, offer.canVisit]);

  const open = (method?: VisitMethod) => dispatch({ type: 'open', method });
  const visitButton = (label: string) => (
    <Button size="lg" leadingIcon={<MapPinCheck aria-hidden="true" />} onClick={() => open()} className="w-full sm:w-auto sm:self-start">
      {label}
    </Button>
  );
  const methodBadge =
    service.myVisit && service.myVisit.status === 'verified' ? (
      <Badge variant="success">
        <BadgeCheck aria-hidden="true" />
        {t('methodLabel', { method: t(`methods.${service.myVisit.method}`) })}
      </Badge>
    ) : null;

  let body;
  switch (offer.stage) {
    case 'none':
      body = (
        <>
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold tracking-tight">{t('promptTitle')}</h2>
            <p className="text-[0.9375rem] text-muted-foreground">{t('promptDescription')}</p>
          </div>
          {visitButton(t('cta'))}
        </>
      );
      break;
    case 'pending':
      body = (
        <>
          <div className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold tracking-tight">{t('title')}</h2>
            <Badge variant="warning" className="self-start">
              <Hourglass aria-hidden="true" />
              {t('pendingTitle')}
            </Badge>
            <p className="text-[0.9375rem] text-muted-foreground">{t('pendingDescription')}</p>
          </div>
          {offer.canVisit ? visitButton(t('again')) : null}
        </>
      );
      break;
    case 'rejected':
      body = (
        <>
          <div className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold tracking-tight">{t('title')}</h2>
            <Badge variant="danger" className="self-start">
              <CircleX aria-hidden="true" />
              {t('rejectedTitle')}
            </Badge>
            <p className="text-[0.9375rem] text-muted-foreground">{t('rejectedDescription')}</p>
          </div>
          {visitButton(t('cta'))}
        </>
      );
      break;
    case 'canReview':
      body = (
        <>
          <div className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold tracking-tight">{t('verifiedTitle')}</h2>
            {methodBadge ? <div>{methodBadge}</div> : null}
          </div>
          <ReviewForm serviceId={service.id} serviceName={service.name} visitId={service.myVisit!.id} />
        </>
      );
      break;
    case 'reviewed':
      body = (
        <>
          <div className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold tracking-tight">{t('reviewedTitle')}</h2>
            <p className="text-[0.9375rem] text-muted-foreground">{t('reviewedDescription')}</p>
          </div>
          {offer.canVisit ? visitButton(t('again')) : null}
        </>
      );
      break;
  }

  return (
    <Card className="flex flex-col gap-4" data-testid="visit-section">
      {body}
      <VisitSheet
        serviceId={service.id}
        serviceName={service.name}
        state={flow}
        dispatch={dispatch}
        onDone={(visit) => notify.success(visit.status === 'verified' ? t('successVerified') : t('successPending'))}
      />
    </Card>
  );
}
