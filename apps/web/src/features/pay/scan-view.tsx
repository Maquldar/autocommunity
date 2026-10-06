'use client';

import { extractPayTag } from '@autoc/shared';
import { Camera, CameraOff, CircleCheck, Keyboard, ReceiptText, ScanLine, Smartphone } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { cn } from '@/lib/cn';
import { usePayPoint } from './api';
import { createNfcAdapter, simulatedTag, type NfcAdapter } from './nfc';

type NfcState = 'checking' | 'unsupported' | 'needsTap' | 'scanning' | 'denied' | 'foreign' | 'detected';

/**
 * /pay — "Оплатить на точке": tap the phone on the NFC sticker at the counter (Web NFC, Chrome on Android).
 * Where Web NFC is missing (iOS, desktop) the QR scan (BarcodeDetector) or the code typed from the sticker
 * get you to the same `/pay/t/<payTag>` page.
 */
export function PayScanView({ adapter: injected }: { adapter?: NfcAdapter } = {}) {
  const t = useTranslations('pay.scan');
  const router = useRouter();
  const search = useSearchParams();
  const adapter = useMemo(() => injected ?? createNfcAdapter(), [injected]);
  const simulated = simulatedTag(search);
  const [state, setState] = useState<NfcState>(simulated ? 'detected' : 'checking');
  const [tag, setTag] = useState<string | null>(simulated);
  const abortRef = useRef<AbortController | null>(null);

  const start = async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await adapter.start(
        {
          onTag: (found) => {
            ctrl.abort();
            setTag(found);
            setState('detected');
          },
          onForeign: () => setState('foreign'),
          onReadError: () => setState('scanning'),
        },
        ctrl.signal,
      );
      if (!ctrl.signal.aborted) setState('scanning');
    } catch (err) {
      // The first scan needs a tap (user activation) for the permission prompt; a refusal is final.
      const name = err instanceof Error ? err.name : '';
      setState(name === 'NotAllowedError' ? 'needsTap' : 'denied');
    }
  };

  useEffect(() => {
    if (simulated) return;
    if (!adapter.supported) {
      setState('unsupported');
      return;
    }
    void start();
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter]);

  // A detected sticker opens its point after a short "found" beat.
  useEffect(() => {
    if (state !== 'detected' || !tag) return;
    const timer = setTimeout(() => router.push(`/pay/t/${tag}`), simulated ? 1600 : 700);
    return () => clearTimeout(timer);
  }, [state, tag, router, simulated]);

  return (
    <div className="mx-auto flex w-full max-w-narrow flex-col gap-5">
      <PageHeader back="/wallet" title={t('title')} description={t('description')} />
      <NfcHero state={state} tag={tag} onStart={() => void start()} />
      {state !== 'detected' ? <Fallbacks primary={state === 'unsupported' || state === 'denied'} /> : null}
      <Link
        href="/pay/orders"
        className="inline-flex min-h-11 items-center justify-center gap-2 self-center rounded-lg px-3 text-[0.9375rem] font-medium text-primary underline-offset-4 hover:underline focus-ring"
      >
        <ReceiptText aria-hidden="true" className="size-4" />
        {t('history')}
      </Link>
    </div>
  );
}

function NfcHero({ state, tag, onStart }: { state: NfcState; tag: string | null; onStart: () => void }) {
  const t = useTranslations('pay.scan');
  const detected = state === 'detected';
  const point = usePayPoint('tag', tag ?? '');
  const live = state === 'scanning' || state === 'checking' || state === 'foreign';

  return (
    <Card className="flex flex-col items-center gap-4 overflow-hidden px-5 py-7 text-center" data-testid="nfc-hero" data-state={state}>
      <div aria-hidden="true" className="relative flex size-48 items-center justify-center">
        {!detected
          ? [0, 0.8, 1.6].map((delay) => (
              <span
                key={delay}
                className={cn('absolute inset-0 rounded-full border-2 border-primary/50', live ? 'animate-nfc-ring' : 'opacity-0')}
                style={{ animationDelay: `${delay}s` }}
              />
            ))
          : null}
        <span className={cn('absolute inset-8 rounded-full', detected ? 'bg-success-soft' : 'bg-primary-soft')} />
        {detected ? (
          <CircleCheck className="relative size-20 animate-check-pop text-success" strokeWidth={1.75} />
        ) : (
          <>
            {/* The "sticker" on the counter and the phone moving onto it. */}
            <span className="absolute bottom-9 flex h-7 w-20 items-center justify-center rounded-md border-2 border-dashed border-primary bg-card text-[0.6875rem] font-bold tracking-wider text-primary">
              NFC
            </span>
            <span className={cn('relative -mt-6 flex h-24 w-14 items-center justify-center rounded-xl border-[3px] border-foreground bg-card shadow-md', live && 'animate-nfc-tap')}>
              <Smartphone className="size-7 text-primary" strokeWidth={1.75} />
            </span>
          </>
        )}
      </div>
      <div className="flex flex-col gap-1.5" aria-live="polite">
        <h2 className="text-balance text-xl font-semibold tracking-tight">{detected ? t('detectedTitle') : t('holdTitle')}</h2>
        <p className="text-pretty text-[0.9375rem] text-muted-foreground" data-testid="nfc-status">
          {detected
            ? point.data
              ? t('detectedPoint', { name: point.data.name })
              : t('detectedOpening')
            : t(`status.${state}`)}
        </p>
      </div>
      {state === 'needsTap' || state === 'foreign' ? (
        <Button leadingIcon={<ScanLine aria-hidden="true" />} onClick={onStart}>
          {t('startNfc')}
        </Button>
      ) : null}
    </Card>
  );
}

function Fallbacks({ primary }: { primary: boolean }) {
  const t = useTranslations('pay.scan');
  const router = useRouter();
  const [code, setCode] = useState('');
  const [error, setError] = useState(false);
  const go = (raw: string) => {
    const tag = extractPayTag(raw);
    if (!tag) {
      setError(true);
      return;
    }
    router.push(`/pay/t/${tag}`);
  };

  return (
    <section aria-labelledby="pay-fallback-title" className="flex flex-col gap-3">
      <h2 id="pay-fallback-title" className={cn('font-semibold', primary ? 'text-xl tracking-tight' : 'text-base')}>
        {primary ? t('fallbackTitlePrimary') : t('fallbackTitle')}
      </h2>
      <Card className="flex flex-col gap-4">
        <QrPayScanner onCode={go} />
        <form
          noValidate
          className="flex flex-col gap-3 border-t pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            go(code);
          }}
        >
          <FormField label={t('codeLabel')} hint={t('codeHint')} error={error ? t('codeInvalid') : undefined}>
            <Input
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setError(false);
              }}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              data-testid="pay-code"
            />
          </FormField>
          <Button type="submit" variant="secondary" leadingIcon={<Keyboard aria-hidden="true" />}>
            {t('codeSubmit')}
          </Button>
        </form>
      </Card>
    </section>
  );
}

type DetectedBarcode = { rawValue: string };
type BarcodeDetectorCtor = new (options: { formats: string[] }) => { detect: (source: HTMLVideoElement) => Promise<DetectedBarcode[]> };
const detectorCtor = (): BarcodeDetectorCtor | null =>
  typeof window !== 'undefined' && 'BarcodeDetector' in window ? (window as unknown as { BarcodeDetector: BarcodeDetectorCtor }).BarcodeDetector : null;

/** Camera QR scan with the native BarcodeDetector; hidden where it isn't available (manual code instead). */
function QrPayScanner({ onCode }: { onCode: (raw: string) => void }) {
  const t = useTranslations('pay.scan');
  const videoRef = useRef<HTMLVideoElement>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [active, setActive] = useState(false);
  const [denied, setDenied] = useState(false);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  useEffect(() => setSupported(detectorCtor() !== null && typeof navigator.mediaDevices?.getUserMedia === 'function'), []);

  useEffect(() => {
    if (!active) return;
    const Ctor = detectorCtor();
    if (!Ctor) return;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const detector = new Ctor({ formats: ['qr_code'] });
    const tick = async () => {
      const video = videoRef.current;
      if (stopped || !video) return;
      try {
        if (video.readyState >= 2) {
          for (const found of await detector.detect(video)) {
            if (extractPayTag(found.rawValue)) {
              setActive(false);
              onCodeRef.current(found.rawValue);
              return;
            }
          }
        }
      } catch {
        // An unreadable frame; try the next one.
      }
      timer = setTimeout(() => void tick(), 300);
    };
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((s) => {
        if (stopped) {
          s.getTracks().forEach((tr) => tr.stop());
          return;
        }
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          void videoRef.current.play().catch(() => undefined);
        }
        void tick();
      })
      .catch(() => {
        setDenied(true);
        setActive(false);
      });
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, [active]);

  if (supported === null) return null;
  if (!supported || denied) {
    return <p className="text-sm text-muted-foreground">{denied ? t('qrDenied') : t('qrUnsupported')}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {active ? (
        <div className="relative overflow-hidden rounded-2xl bg-muted">
          <video ref={videoRef} muted playsInline className="aspect-square w-full object-cover" aria-label={t('qrHint')} />
          <div aria-hidden="true" className="pointer-events-none absolute inset-[18%] rounded-2xl border-4 border-card/90" />
        </div>
      ) : null}
      <Button variant={active ? 'outline' : 'secondary'} leadingIcon={active ? <CameraOff aria-hidden="true" /> : <Camera aria-hidden="true" />} onClick={() => setActive((a) => !a)}>
        {active ? t('qrStop') : t('qrStart')}
      </Button>
    </div>
  );
}
