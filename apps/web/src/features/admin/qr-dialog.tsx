'use client';

import { Printer } from 'lucide-react';
import { useTranslations } from 'next-intl';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ErrorState } from '@/components/ui/error-state';
import { Spinner } from '@/components/ui/spinner';
import { useServiceQr } from './api';

/**
 * Today's visit QR for a verified service, rendered client-side (the `qrcode` package) as a PNG data URL.
 * "Print" opens a minimal printable page with the code, so the admin panel itself is never printed.
 */
export function QrDialog({ service, onClose }: { service: { id: string; name: string; address: string } | null; onClose: () => void }) {
  const t = useTranslations('admin.services.qr');
  const qr = useServiceQr(service?.id ?? '', service !== null);
  const [image, setImage] = useState<string | null>(null);

  useEffect(() => {
    setImage(null);
    if (!qr.data) return;
    let cancelled = false;
    void QRCode.toDataURL(qr.data.url, { errorCorrectionLevel: 'M', margin: 2, width: 512 }).then((url) => {
      if (!cancelled) setImage(url);
    });
    return () => {
      cancelled = true;
    };
  }, [qr.data]);

  const print = () => {
    if (!image || !qr.data || !service) return;
    const w = window.open('', '_blank', 'width=600,height=800');
    if (!w) return;
    const doc = w.document;
    doc.title = service.name;
    const root = doc.createElement('div');
    root.style.cssText = 'font-family:system-ui,sans-serif;text-align:center;padding:32px';
    const h = doc.createElement('h1');
    h.textContent = service.name;
    const addr = doc.createElement('p');
    addr.textContent = service.address;
    const img = doc.createElement('img');
    img.src = image;
    img.style.cssText = 'width:320px;height:320px';
    const code = doc.createElement('p');
    code.style.cssText = 'font-size:28px;letter-spacing:4px;font-family:monospace';
    code.textContent = qr.data.code;
    const hint = doc.createElement('p');
    hint.textContent = t('printHint');
    root.append(h, addr, img, code, hint);
    doc.body.append(root);
    img.onload = () => w.print();
  };

  return (
    <Dialog open={service !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{service ? t('description', { name: service.name }) : null}</DialogDescription>
        </DialogHeader>
        {qr.isPending ? (
          <div className="flex h-64 items-center justify-center">
            <Spinner label={t('loading')} />
          </div>
        ) : qr.isError ? (
          <ErrorState compact onRetry={() => void qr.refetch()} retrying={qr.isFetching} />
        ) : (
          <div className="flex flex-col items-center gap-3">
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element -- generated data URL
              <img src={image} alt={t('alt', { code: qr.data.code })} className="size-56 rounded-xl bg-white p-2" data-testid="service-qr" />
            ) : (
              <div className="flex size-56 items-center justify-center">
                <Spinner label={t('loading')} />
              </div>
            )}
            <p className="font-mono text-2xl tracking-[0.3em]" data-testid="service-qr-code">
              {qr.data.code}
            </p>
            <p className="text-center text-xs text-muted-foreground">{t('validToday')}</p>
          </div>
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {t('close')}
          </Button>
          <Button leadingIcon={<Printer aria-hidden="true" />} disabled={!image} onClick={print}>
            {t('print')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
