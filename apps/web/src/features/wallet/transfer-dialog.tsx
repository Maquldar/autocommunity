'use client';

import { WALLET_LIMITS, type RatingTier, type UserMini } from '@autoc/shared';
import { ArrowLeft, CircleAlert, Search, Send } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { UserAvatar, UserName } from '@/components/ui/user-avatar';
import { useDebounced } from '@/hooks/use-debounced';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { useCurrentUser } from '@/lib/auth/guards';
import { cn } from '@/lib/cn';
import { notify } from '@/lib/toast';
import { useUserSearch } from '@/features/friends/queries';
import { useTransfer, useWallet } from './api';
import { useWalletErrorMessage } from './errors';
import { checkTransferAmount, formatCoins, newIdempotencyKey, TRANSFER_PRESETS } from './format';

export type TransferRecipient = Pick<UserMini, 'id' | 'name' | 'nickname' | 'avatarUrl' | 'rating'> & { isPremium?: boolean; tier?: RatingTier };

/**
 * Send coins: recipient (nickname search, or fixed when opened from a profile) → amount + message →
 * a confirm step with the recipient's avatar and name. One idempotency key per dialog, so a retried or
 * double-tapped send never pays twice (API.md §9.1).
 */
export function TransferDialog({
  open,
  onOpenChange,
  recipient,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fixed recipient (from a profile); omit to search by nickname. */
  recipient?: TransferRecipient | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="transfer-dialog" className="max-w-md">
        {open ? <TransferBody key={recipient?.id ?? 'search'} fixed={recipient ?? null} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function TransferBody({ fixed, onDone }: { fixed: TransferRecipient | null; onDone: () => void }) {
  const t = useTranslations('wallet.transfer');
  const tw = useTranslations('wallet');
  const locale = useLocale();
  const online = useOnlineStatus();
  const errorMessage = useWalletErrorMessage();
  const wallet = useWallet();
  const transfer = useTransfer();
  // Generated once per dialog: a retry after a lost response replays the same transfer.
  const [idempotencyKey] = useState(() => newIdempotencyKey());
  const [step, setStep] = useState<'form' | 'confirm'>('form');
  const [to, setTo] = useState<TransferRecipient | null>(fixed);
  const [amountText, setAmountText] = useState('');
  const [message, setMessage] = useState('');
  const [touched, setTouched] = useState(false);
  const [missingRecipient, setMissingRecipient] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const balance = wallet.data?.balance ?? 0;
  const dailyRemaining = wallet.data?.transferDailyRemaining ?? WALLET_LIMITS.transferDailyCap;
  const check = checkTransferAmount(amountText, { balance, dailyRemaining });
  const amountError =
    touched && !check.ok
      ? t(`amountErrors.${check.error}`, { min: WALLET_LIMITS.transferMin, max: WALLET_LIMITS.transferMax, balance, remaining: dailyRemaining })
      : undefined;

  const next = () => {
    setTouched(true);
    setMissingRecipient(!to);
    if (!to || !check.ok) return;
    setError(null);
    setStep('confirm');
  };

  const send = async () => {
    if (!to || !check.ok) return;
    setError(null);
    try {
      await transfer.mutateAsync({ toUserId: to.id, amount: check.value, message: message.trim() || undefined, idempotencyKey });
      notify.success(t('sent', { coins: tw('coins', { amount: check.value }), name: to.name || `@${to.nickname}` }));
      onDone();
    } catch (err) {
      setError(err);
    }
  };

  const errorBox = error ? (
    <p role="alert" className="flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger-soft-foreground" data-testid="transfer-error">
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      {errorMessage(error)}
    </p>
  ) : null;

  if (step === 'confirm' && to && check.ok) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>{t('confirmTitle')}</DialogTitle>
          <DialogDescription>{t('confirmDescription')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3 rounded-2xl border bg-card p-4 text-center" data-testid="transfer-confirm">
          <UserAvatar user={to} size="lg" decorative />
          <div className="flex min-w-0 max-w-full flex-col items-center">
            <UserName user={to} className="justify-center text-lg font-semibold" />
            <span className="max-w-full truncate text-sm text-muted-foreground">@{to.nickname}</span>
          </div>
          <p className="text-3xl font-bold tabular-nums tracking-tight" data-testid="transfer-confirm-amount">
            {tw('coins', { amount: check.value })}
          </p>
          {message.trim() ? <p className="max-w-full break-words text-sm text-muted-foreground">«{message.trim()}»</p> : null}
        </div>
        <p className="text-sm text-muted-foreground">{t('final')}</p>
        {errorBox}
        <DialogFooter>
          <Button variant="secondary" leadingIcon={<ArrowLeft aria-hidden="true" className="rtl:rotate-180" />} onClick={() => setStep('form')} disabled={transfer.isPending}>
            {t('back')}
          </Button>
          <Button leadingIcon={<Send aria-hidden="true" />} loading={transfer.isPending} disabled={!online} onClick={() => void send()} data-testid="transfer-send">
            {t('send', { coins: tw('coins', { amount: check.value }) })}
          </Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('title')}</DialogTitle>
        <DialogDescription>{t('description')}</DialogDescription>
      </DialogHeader>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          next();
        }}
      >
        {fixed ? (
          <RecipientCard user={fixed} />
        ) : to ? (
          <RecipientCard user={to} onChange={() => setTo(null)} />
        ) : (
          <RecipientSearch
            invalid={missingRecipient}
            onPick={(u) => {
              setTo(u);
              setMissingRecipient(false);
            }}
          />
        )}
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">{t('presets')}</legend>
          <div className="flex flex-wrap gap-2">
            {TRANSFER_PRESETS.map((amount) => (
              <button
                key={amount}
                type="button"
                aria-pressed={check.ok && check.value === amount}
                onClick={() => setAmountText(String(amount))}
                className={cn(
                  'min-h-11 rounded-full border px-4 text-sm font-semibold tabular-nums focus-ring',
                  check.ok && check.value === amount ? 'border-primary bg-primary-soft text-primary-soft-foreground' : 'bg-card hover:bg-accent',
                )}
              >
                {formatCoins(amount, locale)}
              </button>
            ))}
          </div>
        </fieldset>
        <FormField
          label={t('amount')}
          required
          hint={wallet.data ? t('amountHint', { balance, remaining: dailyRemaining }) : undefined}
          error={amountError}
        >
          <Input
            value={amountText}
            onChange={(e) => setAmountText(e.target.value.replace(/[^\d\s]/g, ''))}
            onBlur={() => setTouched(true)}
            inputMode="numeric"
            autoComplete="off"
            data-testid="transfer-amount"
          />
        </FormField>
        <FormField label={t('message')} hint={t('messageHint')}>
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value.replace(/[\n\t]/g, ' '))}
            maxLength={WALLET_LIMITS.transferMessageMax}
            showCount
            rows={2}
            data-testid="transfer-message"
          />
        </FormField>
        <p className="text-sm text-muted-foreground">{tw('noCashOut')}</p>
        {errorBox}
        <DialogFooter>
          <Button variant="secondary" onClick={onDone}>
            {t('cancel')}
          </Button>
          <Button type="submit" disabled={!online || wallet.isPending}>
            {t('next')}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

function RecipientCard({ user, onChange }: { user: TransferRecipient; onChange?: () => void }) {
  const t = useTranslations('wallet.transfer');
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[0.9375rem] font-medium">{t('recipient')}</span>
      <div className="flex items-center gap-3 rounded-xl border bg-card p-3" data-testid="transfer-recipient">
        <UserAvatar user={user} size="md" decorative />
        <span className="flex min-w-0 flex-1 flex-col">
          <UserName user={user} className="font-medium" />
          <span className="truncate text-sm text-muted-foreground">@{user.nickname}</span>
        </span>
        {onChange ? (
          <Button size="sm" variant="ghost" onClick={onChange}>
            {t('change')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Nickname search (the friends search endpoint); the caller's own account is left out. */
function RecipientSearch({ onPick, invalid }: { onPick: (u: TransferRecipient) => void; invalid: boolean }) {
  const t = useTranslations('wallet.transfer');
  const me = useCurrentUser();
  const [q, setQ] = useState('');
  const debounced = useDebounced(q.trim().replace(/^@/, ''), 300);
  const query = useUserSearch(debounced);
  const listId = useId();
  const items = (query.data?.pages.flatMap((p) => p.items) ?? []).filter((u) => u.id !== me.id && u.status === 'active').slice(0, 8);

  return (
    <div className="flex flex-col gap-2">
      <FormField label={t('recipient')} required hint={t('searchHint')} error={invalid ? t('recipientRequired') : undefined}>
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('searchPlaceholder')}
          autoComplete="off"
          aria-controls={listId}
          data-testid="transfer-search"
        />
      </FormField>
      <div id={listId} aria-live="polite">
        {debounced.length < 2 ? null : query.isPending ? (
          <div aria-busy="true" className="flex flex-col gap-2">
            <Spinner size="sm" label={t('searching')} />
            <Skeleton className="h-12 w-full rounded-xl" />
          </div>
        ) : items.length === 0 ? (
          <p className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
            <Search aria-hidden="true" className="size-4" />
            {t('noResults')}
          </p>
        ) : (
          <ul className="flex max-h-60 flex-col overflow-y-auto rounded-xl border bg-card [&>li+li]:border-t" aria-label={t('results')}>
            {items.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  onClick={() => onPick(u)}
                  className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-start hover:bg-accent focus-ring focus-visible:-outline-offset-2"
                  data-testid="transfer-candidate"
                >
                  <UserAvatar user={u} size="sm" decorative />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <UserName user={u} className="text-[0.9375rem] font-medium" />
                    <span className="truncate text-sm text-muted-foreground">@{u.nickname}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
