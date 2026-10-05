'use client';

import { LIMITS, normalizeQrCode, SERVICE_LIMITS, type VisitDto, type VisitMethod } from '@autoc/shared';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, Camera, ChevronRight, ImagePlus, MapPin, QrCode, RotateCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type Dispatch, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api/errors';
import { useCreateVisit } from './api';
import { useServiceErrorMessage } from './errors';
import { QrScanner } from './qr-scanner';
import { getCurrentPosition } from './use-position';
import { isFlowOpen, type VisitFlowAction, type VisitFlowState } from './visit-flow';

const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

type Props = {
  serviceId: string;
  serviceName: string;
  state: VisitFlowState;
  dispatch: Dispatch<VisitFlowAction>;
  onDone: (visit: VisitDto) => void;
};

/** "I visited" bottom sheet: choose geo / QR / order photo, then run that check. */
export function VisitSheet({ serviceId, serviceName, state, dispatch, onDone }: Props) {
  const t = useTranslations('services.visit');
  const create = useCreateVisit(serviceId);

  const submit = async (input: Parameters<typeof create.mutateAsync>[0]) => {
    const visit = await create.mutateAsync(input);
    dispatch({ type: 'succeed', visit });
    onDone(visit);
  };

  const methodStep = state.step === 'geo' || state.step === 'qr' || state.step === 'photo' ? state : null;
  const working = methodStep?.phase === 'working';

  return (
    <Sheet open={isFlowOpen(state)} onOpenChange={(open) => !open && dispatch({ type: 'close' })}>
      <SheetContent
        onInteractOutside={(e) => working && e.preventDefault()}
        onEscapeKeyDown={(e) => working && e.preventDefault()}
        // After a successful visit the "I visited" trigger is gone; the section moves focus itself.
        onCloseAutoFocus={(e) => state.step === 'done' && e.preventDefault()}
      >
        <SheetHeader>
          <SheetTitle>{t('sheetTitle')}</SheetTitle>
          <SheetDescription>{t('sheetDescription', { name: serviceName })}</SheetDescription>
        </SheetHeader>

        {state.step === 'choose' ? <ChooseMethod onChoose={(method) => dispatch({ type: 'choose', method })} /> : null}
        {methodStep?.step === 'geo' ? <GeoStep state={methodStep} dispatch={dispatch} submit={submit} /> : null}
        {methodStep?.step === 'qr' ? <QrStep state={methodStep} dispatch={dispatch} submit={submit} /> : null}
        {methodStep?.step === 'photo' ? <PhotoStep state={methodStep} dispatch={dispatch} submit={submit} /> : null}

        {methodStep ? (
          <SheetFooter>
            <Button variant="ghost" leadingIcon={<ArrowLeft aria-hidden="true" className="rtl:rotate-180" />} disabled={working} onClick={() => dispatch({ type: 'back' })}>
              {t('back')}
            </Button>
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function ChooseMethod({ onChoose }: { onChoose: (m: VisitMethod) => void }) {
  const t = useTranslations('services.visit');
  const options: { method: VisitMethod; icon: typeof MapPin; title: string; description: string }[] = [
    { method: 'geo', icon: MapPin, title: t('geoTitle'), description: t('geoDescription', { radius: SERVICE_LIMITS.geoVisitRadiusM }) },
    { method: 'qr', icon: QrCode, title: t('qrTitle'), description: t('qrDescription') },
    { method: 'photo', icon: Camera, title: t('photoTitle'), description: t('photoDescription') },
  ];
  return (
    <div className="flex flex-col gap-2" role="group" aria-label={t('chooseMethod')}>
      {options.map(({ method, icon: Icon, title, description }) => (
        <button
          key={method}
          type="button"
          onClick={() => onChoose(method)}
          className="flex min-h-16 items-center gap-3 rounded-xl border bg-card p-3 text-start focus-ring transition-colors duration-fast hover:border-input hover:bg-accent"
        >
          <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-foreground">
            <Icon className="size-5" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="font-semibold">{title}</span>
            <span className="text-sm text-muted-foreground">{description}</span>
          </span>
          <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-muted-foreground rtl:rotate-180" />
        </button>
      ))}
    </div>
  );
}

type MethodState = Extract<VisitFlowState, { phase: unknown }>;

type StepProps = {
  state: MethodState;
  dispatch: Dispatch<VisitFlowAction>;
  submit: (input: Parameters<ReturnType<typeof useCreateVisit>['mutateAsync']>[0]) => Promise<void>;
};

function useRun(dispatch: Dispatch<VisitFlowAction>) {
  return async (fn: () => Promise<void>) => {
    dispatch({ type: 'start' });
    try {
      await fn();
    } catch (error) {
      dispatch({ type: 'fail', error });
    }
  };
}

function StepError({ error }: { error: unknown }) {
  const message = useServiceErrorMessage();
  return error ? <FormError>{message(error)}</FormError> : null;
}

function GeoStep({ state, dispatch, submit }: StepProps) {
  const t = useTranslations('services.visit');
  const run = useRun(dispatch);
  const [phase, setPhase] = useState<'locating' | 'checking'>('locating');
  const check = () =>
    run(async () => {
      setPhase('locating');
      const at = await getCurrentPosition({ maximumAgeMs: 0 });
      setPhase('checking');
      await submit({ method: 'geo', lat: at.lat, lng: at.lng });
    });

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[0.9375rem]">{t('geoDescription', { radius: SERVICE_LIMITS.geoVisitRadiusM })}</p>
      {state.phase === 'working' ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner size="sm" label={phase === 'locating' ? t('geoLocating') : t('geoChecking')} />
          <span aria-hidden="true">{phase === 'locating' ? t('geoLocating') : t('geoChecking')}</span>
        </p>
      ) : null}
      <StepError error={state.phase === 'error' ? state.error : null} />
      <Button
        size="lg"
        fullWidth
        loading={state.phase === 'working'}
        leadingIcon={state.phase === 'error' ? <RotateCw aria-hidden="true" /> : <MapPin aria-hidden="true" />}
        onClick={() => void check()}
      >
        {state.phase === 'error' ? t('geoRetry') : t('geoStart')}
      </Button>
    </div>
  );
}

function QrStep({ state, dispatch, submit }: StepProps) {
  const t = useTranslations('services.visit');
  const run = useRun(dispatch);
  const [code, setCode] = useState(state.code);
  const [formatError, setFormatError] = useState(false);
  const autoSubmitted = useRef(false);

  const send = (value: string) => {
    const normalized = normalizeQrCode(value);
    if (normalized.length !== SERVICE_LIMITS.qrCodeLength) {
      setFormatError(true);
      return;
    }
    setFormatError(false);
    void run(() => submit({ method: 'qr', code: normalized }));
  };

  // A code from a scanned printed QR (deep link ?code=) is submitted right away, once.
  useEffect(() => {
    if (state.code && !autoSubmitted.current) {
      autoSubmitted.current = true;
      send(state.code);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(code);
  };

  return (
    <div className="flex flex-col gap-4">
      <QrScanner
        onCode={(scanned) => {
          setCode(scanned);
          send(scanned);
        }}
      />
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-3">
        <FormField label={t('qrManualLabel')} hint={t('qrManualHint')} error={formatError ? t('qrInvalidFormat') : undefined}>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={16}
            placeholder="ABCD2345"
            enterKeyHint="send"
            className="font-mono tracking-widest"
          />
        </FormField>
        <StepError error={state.phase === 'error' ? state.error : null} />
        <Button type="submit" size="lg" fullWidth loading={state.phase === 'working'} leadingIcon={<QrCode aria-hidden="true" />}>
          {t('qrSubmit')}
        </Button>
      </form>
    </div>
  );
}

function PhotoStep({ state, dispatch, submit }: StepProps) {
  const t = useTranslations('services.visit');
  const run = useRun(dispatch);
  const inputRef = useRef<HTMLInputElement>(null);
  const previewAlt = useId();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const upload = useMutation({ mutationFn: (f: File) => api.uploads.create(f, 'order') });

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (f.type && !PHOTO_TYPES.includes(f.type)) {
      dispatch({ type: 'fail', error: new ApiError({ status: 415, code: 'UNSUPPORTED_FILE_TYPE', message: 'Unsupported file type' }) });
      return;
    }
    if (f.size > LIMITS.imageMaxBytes) {
      dispatch({ type: 'fail', error: new ApiError({ status: 413, code: 'FILE_TOO_LARGE', message: 'File is too large' }) });
      return;
    }
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const send = () =>
    run(async () => {
      if (!file) return;
      const uploaded = await upload.mutateAsync(file);
      await submit({ method: 'photo', uploadId: uploaded.id });
    });

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[0.9375rem]">{t('photoDescription')}</p>
      <input
        ref={inputRef}
        type="file"
        accept={PHOTO_TYPES.join(',')}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="order-photo-input"
        onChange={(e) => {
          pick(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
        <img id={previewAlt} src={preview} alt={t('photoPreview')} className="max-h-60 w-full rounded-xl bg-muted object-contain" />
      ) : null}
      <Button variant={file ? 'outline' : 'secondary'} leadingIcon={<ImagePlus aria-hidden="true" />} disabled={state.phase === 'working'} onClick={() => inputRef.current?.click()}>
        {file ? t('photoChange') : t('photoChoose')}
      </Button>
      {upload.isPending ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner size="sm" label={t('photoUploading')} />
          <span aria-hidden="true">{t('photoUploading')}</span>
        </p>
      ) : null}
      <StepError error={state.phase === 'error' ? state.error : null} />
      {file ? (
        <Button size="lg" fullWidth loading={state.phase === 'working'} onClick={() => void send()}>
          {t('photoSubmit')}
        </Button>
      ) : null}
    </div>
  );
}
