'use client';

import { extractQrCode } from '@autoc/shared';
import { Camera, CameraOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = { detect: (source: HTMLVideoElement) => Promise<DetectedBarcode[]> };
type BarcodeDetectorCtor = new (options: { formats: string[] }) => BarcodeDetectorLike;

const detectorCtor = (): BarcodeDetectorCtor | null =>
  typeof window !== 'undefined' && 'BarcodeDetector' in window ? (window as unknown as { BarcodeDetector: BarcodeDetectorCtor }).BarcodeDetector : null;

export const canScanQr = () =>
  detectorCtor() !== null && typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';

/**
 * Camera QR scanning with the native BarcodeDetector (Chrome/Edge on Android, Safari 17+ behind support).
 * Where it isn't available the caller's manual code field is the way in.
 */
export function QrScanner({ onCode }: { onCode: (code: string) => void }) {
  const t = useTranslations('services.visit');
  const videoRef = useRef<HTMLVideoElement>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [active, setActive] = useState(false);
  const [denied, setDenied] = useState(false);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  useEffect(() => setSupported(canScanQr()), []);

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
            const code = extractQrCode(found.rawValue);
            if (code) {
              onCodeRef.current(code);
              setActive(false);
              return;
            }
          }
        }
      } catch {
        // A frame that can't be read; try the next one.
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
        const video = videoRef.current;
        if (video) {
          video.srcObject = s;
          void video.play().catch(() => undefined);
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
    return <p className="text-sm text-muted-foreground">{denied ? t('qrCameraDenied') : t('qrCameraUnsupported')}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {active ? (
        <div className="relative overflow-hidden rounded-2xl bg-muted">
          <video ref={videoRef} muted playsInline className="aspect-square w-full object-cover" aria-label={t('qrCameraHint')} />
          <div aria-hidden="true" className="pointer-events-none absolute inset-[18%] rounded-2xl border-4 border-card/90" />
          <p className="absolute inset-x-0 bottom-2 text-center text-sm font-medium text-white drop-shadow">{t('qrCameraHint')}</p>
        </div>
      ) : null}
      <Button
        variant={active ? 'outline' : 'secondary'}
        leadingIcon={active ? <CameraOff aria-hidden="true" /> : <Camera aria-hidden="true" />}
        onClick={() => setActive((a) => !a)}
      >
        {active ? t('qrCameraStop') : t('qrCamera')}
      </Button>
    </div>
  );
}
