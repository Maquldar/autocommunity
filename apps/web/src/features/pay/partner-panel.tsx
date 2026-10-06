'use client';

import { PAY_LIMITS, PAY_UNITS, type PayItemInput, type PayPointManageDto, type PayUnit } from '@autoc/shared';
import { Copy, CreditCard, Nfc, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/error-state';
import { IconButton } from '@/components/ui/icon-button';
import { controlClasses, Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useErrorMessage } from '@/hooks/use-error-message';
import { useCurrentUser } from '@/lib/auth/guards';
import { cn } from '@/lib/cn';
import { notify } from '@/lib/toast';
import { NoteDialog } from '@/features/admin/note-dialog';
import { payApi, usePayManage, usePayManageMutation } from './api';

type Row = { key: string; id?: string; name: string; price: string; unit: PayUnit };

const toRows = (dto: PayPointManageDto): Row[] => dto.items.map((i) => ({ key: i.id, id: i.id, name: i.name, price: String(i.priceCoins), unit: i.unit }));

/** Row problems the server would refuse anyway, so the editor can say which row is wrong. */
function rowError(r: Row): 'name' | 'price' | null {
  const name = r.name.trim();
  if (name.length < PAY_LIMITS.itemNameMin || name.length > PAY_LIMITS.itemNameMax) return 'name';
  const price = Number(r.price.replace(/\s/g, ''));
  if (!Number.isInteger(price) || price < PAY_LIMITS.priceMin || price > PAY_LIMITS.priceMax) return 'price';
  return null;
}

/**
 * On the service page for admins and the point's owner (API.md §11): the partner switch (admin), the price
 * list editor, and the sticker: the payTag QR code, the "NFC link" to write onto a sticker, and rotation.
 */
export function PartnerPanel({ serviceId }: { serviceId: string }) {
  const t = useTranslations('pay.partner');
  const me = useCurrentUser();
  const query = usePayManage(serviceId, true);

  return (
    <Card className="flex flex-col gap-4" data-testid="partner-panel">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-foreground">
          <CreditCard className="size-5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="text-lg font-semibold">{t('title')}</h2>
          <p className="text-sm text-muted-foreground">{me.role === 'admin' ? t('descriptionAdmin') : t('descriptionOwner')}</p>
        </div>
      </div>
      {query.isPending ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : query.isError ? (
        <ErrorState compact onRetry={() => void query.refetch()} retrying={query.isFetching} />
      ) : (
        <PanelBody dto={query.data} serviceId={serviceId} isAdmin={me.role === 'admin'} isOwner={query.data.ownerId === me.id} />
      )}
    </Card>
  );
}

function PanelBody({ dto, serviceId, isAdmin, isOwner }: { dto: PayPointManageDto; serviceId: string; isAdmin: boolean; isOwner: boolean }) {
  const t = useTranslations('pay.partner');
  const [toggleOpen, setToggleOpen] = useState(false);
  const partner = usePayManageMutation(serviceId, (note: string) => payApi.partner(serviceId, { acceptsPayments: !dto.acceptsPayments, note }));

  return (
    <>
      <div className="flex items-center justify-between gap-3 rounded-xl bg-muted px-3 py-2.5">
        <span className="flex flex-col">
          <span id="partner-accepts" className="font-medium">
            {t('accepts')}
          </span>
          <span className="text-sm text-muted-foreground">
            {dto.ownerNickname ? t('owner', { nickname: dto.ownerNickname }) : t('noOwner')}
          </span>
        </span>
        {isAdmin ? (
          <Switch checked={dto.acceptsPayments} onCheckedChange={() => setToggleOpen(true)} aria-labelledby="partner-accepts" data-testid="partner-switch" />
        ) : (
          <Badge variant={dto.acceptsPayments ? 'success' : 'neutral'} size="sm">
            {dto.acceptsPayments ? t('on') : t('off')}
          </Badge>
        )}
      </div>
      {isAdmin ? (
        <NoteDialog
          open={toggleOpen}
          onOpenChange={setToggleOpen}
          title={dto.acceptsPayments ? t('disableTitle') : t('enableTitle')}
          description={dto.acceptsPayments ? t('disableHint') : t('enableHint')}
          confirmLabel={dto.acceptsPayments ? t('disable') : t('enable')}
          onConfirm={(note) => partner.mutateAsync(note)}
          successMessage={t('saved')}
        />
      ) : null}
      <ItemsEditor dto={dto} serviceId={serviceId} needsNote={isAdmin && !isOwner} />
      {dto.payTag && dto.payUrl ? <Sticker dto={dto} serviceId={serviceId} canRotate={dto.canRotate} /> : null}
    </>
  );
}

function ItemsEditor({ dto, serviceId, needsNote }: { dto: PayPointManageDto; serviceId: string; needsNote: boolean }) {
  const t = useTranslations('pay.partner');
  const tu = useTranslations('pay.units');
  const errorMessage = useErrorMessage();
  const [rows, setRows] = useState<Row[]>(() => toRows(dto));
  const [noteOpen, setNoteOpen] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const save = usePayManageMutation(serviceId, (note: string | undefined) => {
    const items: PayItemInput[] = rows.map((r) => ({ ...(r.id ? { id: r.id } : {}), name: r.name.trim(), priceCoins: Number(r.price.replace(/\s/g, '')), unit: r.unit }));
    return payApi.putItems(serviceId, { items, ...(note ? { note } : {}) });
  });
  useEffect(() => setRows(toRows(dto)), [dto]);

  const dirty = JSON.stringify(rows.map(({ key: _k, ...r }) => r)) !== JSON.stringify(toRows(dto).map(({ key: _k, ...r }) => r));
  const invalid = rows.some((r) => rowError(r) !== null);
  const patch = (key: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));

  const submit = () => {
    setShowErrors(true);
    if (invalid) return;
    if (needsNote) setNoteOpen(true);
    else
      void save.mutateAsync(undefined).then(
        () => notify.success(t('saved')),
        (err: unknown) => notify.error(errorMessage(err)),
      );
  };

  return (
    <section aria-labelledby="partner-items" className="flex flex-col gap-2">
      <h3 id="partner-items" className="text-base font-semibold">
        {t('items')}
      </h3>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">{t('noItems')}</p> : null}
      <ul className="flex flex-col gap-2">
        {rows.map((r, i) => {
          const err = showErrors ? rowError(r) : null;
          return (
            <li key={r.key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-xl border p-2" data-testid="partner-item">
              <Input value={r.name} onChange={(e) => patch(r.key, { name: e.target.value })} aria-label={t('itemName', { n: i + 1 })} aria-invalid={err === 'name' || undefined} maxLength={PAY_LIMITS.itemNameMax} />
              <IconButton variant="ghost" aria-label={t('remove', { name: r.name || String(i + 1) })} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                <Trash2 />
              </IconButton>
              <div className="col-span-2 grid grid-cols-2 gap-2">
                <Input value={r.price} onChange={(e) => patch(r.key, { price: e.target.value })} inputMode="numeric" aria-label={t('itemPrice', { n: i + 1 })} aria-invalid={err === 'price' || undefined} />
                <select value={r.unit} onChange={(e) => patch(r.key, { unit: e.target.value as PayUnit })} aria-label={t('itemUnit', { n: i + 1 })} className={cn(controlClasses, 'h-11 px-3')}>
                  {PAY_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {tu(u)}
                    </option>
                  ))}
                </select>
              </div>
              {err ? <p className="col-span-2 text-sm text-danger">{t(`errors.${err}`)}</p> : null}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          leadingIcon={<Plus aria-hidden="true" />}
          disabled={rows.length >= PAY_LIMITS.itemsPerPoint}
          onClick={() => setRows((rs) => [...rs, { key: `new-${Date.now()}`, name: '', price: '', unit: 'service' }])}
        >
          {t('add')}
        </Button>
        <Button size="sm" onClick={submit} loading={save.isPending} disabled={!dirty} data-testid="partner-save">
          {t('save')}
        </Button>
      </div>
      {needsNote ? (
        <NoteDialog open={noteOpen} onOpenChange={setNoteOpen} title={t('saveTitle')} confirmLabel={t('save')} onConfirm={(note) => save.mutateAsync(note)} successMessage={t('saved')} />
      ) : null}
    </section>
  );
}

function Sticker({ dto, serviceId, canRotate }: { dto: PayPointManageDto; serviceId: string; canRotate: boolean }) {
  const t = useTranslations('pay.partner');
  const [image, setImage] = useState<string | null>(null);
  const [rotateOpen, setRotateOpen] = useState(false);
  const rotate = usePayManageMutation(serviceId, (note: string) => payApi.rotate(serviceId, note));
  const url = dto.payUrl!;
  const canWrite = typeof window !== 'undefined' && 'NDEFReader' in window;

  useEffect(() => {
    let cancelled = false;
    void QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 2, width: 384 }).then((d) => {
      if (!cancelled) setImage(d);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      notify.success(t('copied'));
    } catch {
      notify.error(t('copyFailed'));
    }
  };

  const writeTag = async () => {
    try {
      const Writer = (window as unknown as { NDEFReader: new () => { write: (m: unknown) => Promise<void> } }).NDEFReader;
      await new Writer().write({ records: [{ recordType: 'url', data: url }] });
      notify.success(t('written'));
    } catch {
      notify.error(t('writeFailed'));
    }
  };

  return (
    <section aria-labelledby="partner-sticker" className="flex flex-col gap-3 border-t pt-4">
      <h3 id="partner-sticker" className="text-base font-semibold">
        {t('sticker')}
      </h3>
      <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element -- a generated data URL
          <img src={image} alt={t('qrAlt', { name: dto.name })} className="size-40 shrink-0 rounded-xl border bg-white p-1" data-testid="partner-qr" />
        ) : (
          <Skeleton className="size-40 shrink-0 rounded-xl" />
        )}
        <div className="flex w-full min-w-0 flex-col gap-2">
          <span className="text-sm font-medium">{t('nfcLink')}</span>
          <code className="break-all rounded-lg bg-muted px-3 py-2 text-sm" data-testid="partner-paylink">
            {url}
          </code>
          <p className="text-sm text-muted-foreground">{t('stickerHint')}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" leadingIcon={<Copy aria-hidden="true" />} onClick={() => void copy()}>
              {t('copy')}
            </Button>
            {canWrite ? (
              <Button size="sm" variant="secondary" leadingIcon={<Nfc aria-hidden="true" />} onClick={() => void writeTag()}>
                {t('write')}
              </Button>
            ) : null}
            {canRotate ? (
              <Button size="sm" variant="outline" leadingIcon={<RefreshCw aria-hidden="true" />} onClick={() => setRotateOpen(true)} data-testid="partner-rotate">
                {t('rotate')}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      {canRotate ? (
        <NoteDialog
          open={rotateOpen}
          onOpenChange={setRotateOpen}
          title={t('rotateTitle')}
          description={t('rotateHint')}
          confirmLabel={t('rotate')}
          tone="danger"
          onConfirm={(note) => rotate.mutateAsync(note)}
          successMessage={t('rotated')}
        />
      ) : null}
    </section>
  );
}
