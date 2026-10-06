'use client';

import { WALLET_LIMITS } from '@autoc/shared';
import { CircleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { cn } from '@/lib/cn';
import { useCreateTopup } from './api';
import { useWalletErrorMessage } from './errors';
import { checkTopupAmount, TOPUP_PRESETS } from './format';

/** Amount presets plus a custom amount (500..200 000); creates a top-up and opens the checkout. */
export function TopupDialog({ open, onOpenChange, initialAmount }: { open: boolean; onOpenChange: (open: boolean) => void; initialAmount?: number }) {
  const t = useTranslations('wallet.topup');
  const tw = useTranslations('wallet');
  const router = useRouter();
  const online = useOnlineStatus();
  const errorMessage = useWalletErrorMessage();
  const create = useCreateTopup();
  const [text, setText] = useState('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!open) return;
    setText(initialAmount ? String(Math.max(WALLET_LIMITS.topupMin, Math.min(WALLET_LIMITS.topupMax, initialAmount))) : String(TOPUP_PRESETS[1]));
    setTouched(false);
    setError(null);
  }, [open, initialAmount]);

  const check = checkTopupAmount(text);
  const fieldError = touched && !check.ok ? t(`amountErrors.${check.error}`, { min: WALLET_LIMITS.topupMin, max: WALLET_LIMITS.topupMax }) : undefined;

  const submit = async () => {
    setTouched(true);
    if (!check.ok) return;
    setError(null);
    try {
      const { topup } = await create.mutateAsync(check.value);
      onOpenChange(false);
      router.push(`/wallet/checkout/${topup.id}`);
    } catch (err) {
      setError(err);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (create.isPending ? undefined : onOpenChange(next))}>
      <DialogContent data-testid="topup-dialog">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-[0.9375rem] font-medium">{t('presets')}</legend>
            <div className="grid grid-cols-2 gap-2">
              {TOPUP_PRESETS.map((amount) => {
                const selected = check.ok && check.value === amount;
                return (
                  <button
                    key={amount}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      setText(String(amount));
                      setTouched(false);
                    }}
                    className={cn(
                      'min-h-11 rounded-xl border px-3 text-[0.9375rem] font-semibold tabular-nums transition-colors duration-fast focus-ring',
                      selected ? 'border-primary bg-primary-soft text-primary-soft-foreground' : 'bg-card hover:bg-accent',
                    )}
                  >
                    {tw('coins', { amount })}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <FormField label={t('amount')} hint={t('amountHint', { min: WALLET_LIMITS.topupMin, max: WALLET_LIMITS.topupMax })} error={fieldError} required>
            <Input
              value={text}
              onChange={(e) => setText(e.target.value.replace(/[^\d\s]/g, ''))}
              onBlur={() => setTouched(true)}
              inputMode="numeric"
              autoComplete="off"
              enterKeyHint="go"
              data-testid="topup-amount"
            />
          </FormField>
          <p className="text-sm text-muted-foreground">{tw('rate')}</p>
          {error ? (
            <p role="alert" className="flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger-soft-foreground">
              <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {errorMessage(error)}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={create.isPending}>
              {t('cancel')}
            </Button>
            <Button type="submit" loading={create.isPending} disabled={!online}>
              {check.ok ? t('continueAmount', { amount: check.value }) : t('continue')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
