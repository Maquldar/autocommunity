'use client';

import { FUEL_PRESETS_L, FULL_TANK_L, type PayMethod, type PayPointDto } from '@autoc/shared';
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import { ArrowRight, CircleAlert, Coins, CreditCard, FlaskConical, MapPin, Minus, Plus, Store } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { CategoryTile } from '@/components/services/category';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { IconButton } from '@/components/ui/icon-button';
import { PageHeader } from '@/components/ui/page-header';
import { RadioCard, RadioGroup } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { hasErrorCode } from '@/lib/api/errors';
import { cn } from '@/lib/cn';
import { useWallet } from '@/features/wallet/api';
import { formatCoins } from '@/features/wallet/format';
import { useCreateOrder, usePayPoint } from './api';
import { usePayErrorMessage } from './errors';
import { cartTotal, defaultQty, formatQty, newPayKey, parseQty, pointInitials, qtyLabel, stepQty, type Cart } from './format';
import { GooglePayButton } from './google-pay-button';
import type { GooglePayResult } from './google-pay';

/** The action bar stays above the phone tab bar (and its raised SOS button) while the list scrolls. */
const STICKY = 'sticky z-raised bottom-[calc(var(--nav-height)+var(--safe-bottom)+1.75rem)] lg:bottom-4';

/** /pay/t/[tag] and /pay/[serviceId]: a partner point's checkout (API.md §11). */
export function PayPointView({ by, value }: { by: 'id' | 'tag'; value: string }) {
  const t = useTranslations('pay');
  const query = usePayPoint(by, value);

  return (
    <div className="mx-auto flex w-full max-w-narrow flex-col gap-4">
      <PageHeader back="/pay" title={t('point.title')} className="pb-0" />
      {query.isPending ? (
        <div aria-busy="true" className="flex flex-col gap-4">
          <span className="sr-only">{t('point.loading')}</span>
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-56 w-full rounded-2xl" />
        </div>
      ) : query.isError ? (
        hasErrorCode(query.error, 'NOT_FOUND') || hasErrorCode(query.error, 'VALIDATION_ERROR') ? (
          <EmptyState
            icon={Store}
            title={t('point.notFound')}
            description={t('point.notFoundHint')}
            action={
              <Button asChild>
                <Link href="/pay">{t('point.scanAgain')}</Link>
              </Button>
            }
            className="rounded-2xl border bg-card"
          />
        ) : (
          <ErrorState onRetry={() => void query.refetch()} retrying={query.isFetching} className="rounded-2xl border bg-card" />
        )
      ) : (
        <Checkout point={query.data} />
      )}
    </div>
  );
}

export function PointCard({ point }: { point: Pick<PayPointDto, 'name' | 'category' | 'address' | 'logoUrl'> }) {
  const t = useTranslations();
  return (
    <Card className="flex items-center gap-4" data-testid="pay-point">
      {point.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- media from the API origin
        <img src={point.logoUrl} alt="" className="size-14 shrink-0 rounded-xl object-cover" />
      ) : (
        <span aria-hidden="true" className="relative flex size-14 shrink-0">
          <CategoryTile category={point.category} className="size-14 text-lg font-bold" iconClassName="hidden" />
          <span className="absolute inset-0 flex items-center justify-center text-lg font-bold text-white">{pointInitials(point.name)}</span>
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h2 className="break-words text-xl font-semibold tracking-tight" data-testid="pay-point-name">
          {point.name}
        </h2>
        <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <CategoryTile category={point.category} className="size-5 rounded-md" iconClassName="size-3" />
          {t(`services.categories.${point.category}`)}
        </span>
        <span className="inline-flex items-start gap-1.5 text-sm text-muted-foreground">
          <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span className="break-words">{point.address}</span>
        </span>
      </div>
    </Card>
  );
}

function Checkout({ point }: { point: PayPointDto }) {
  const [step, setStep] = useState<'pick' | 'method'>('pick');
  const [cart, setCart] = useState<Cart>(() => (point.items.length === 1 ? { item: point.items[0]!, qty: defaultQty(point.items[0]!.unit) } : null));
  // One key per checkout screen: a retried confirm replays instead of paying twice.
  const [idempotencyKey] = useState(newPayKey);

  return (
    <>
      <PointCard point={point} />
      {step === 'pick' ? (
        <PickStep point={point} cart={cart} onCart={setCart} onNext={() => setStep('method')} />
      ) : (
        <MethodStep point={point} cart={cart!} idempotencyKey={idempotencyKey} onBack={() => setStep('pick')} />
      )}
    </>
  );
}

function PickStep({ point, cart, onCart, onNext }: { point: PayPointDto; cart: Cart; onCart: (c: Cart) => void; onNext: () => void }) {
  const t = useTranslations('pay');
  const locale = useLocale();
  const total = cartTotal(cart);

  if (!point.items.length) {
    return <EmptyState icon={Store} title={t('point.noItems')} description={t('point.noItemsHint')} className="rounded-2xl border bg-card" />;
  }

  return (
    <>
      <section aria-labelledby="pay-items-title" className="flex flex-col gap-2">
        <h2 id="pay-items-title" className="text-base font-semibold">
          {point.items.some((i) => i.unit === 'l') ? t('point.pickFuel') : t('point.pickService')}
        </h2>
        <RadioGroupPrimitive.Root
          value={cart?.item.id ?? ''}
          onValueChange={(id) => {
            const item = point.items.find((i) => i.id === id)!;
            onCart({ item, qty: cart && cart.item.unit === item.unit ? cart.qty : defaultQty(item.unit) });
          }}
          aria-labelledby="pay-items-title"
          className="flex flex-col overflow-hidden rounded-2xl border bg-card"
        >
          {point.items.map((item, i) => (
            <RadioGroupPrimitive.Item
              key={item.id}
              value={item.id}
              data-testid="pay-item"
              className={cn(
                'group flex min-h-16 w-full items-center gap-3 px-4 py-3 text-start transition-colors duration-fast focus-ring focus-visible:-outline-offset-2',
                'hover:bg-accent data-[state=checked]:bg-primary-soft',
                i > 0 && 'border-t',
              )}
            >
              <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-input bg-card group-data-[state=checked]:border-primary">
                <span className="size-2.5 scale-0 rounded-full bg-primary transition-transform duration-fast group-data-[state=checked]:scale-100" />
              </span>
              <span className="min-w-0 flex-1 break-words text-[0.9375rem] font-medium">{item.name}</span>
              <span className="flex shrink-0 flex-col items-end">
                <span className="font-semibold tabular-nums">{t('coinsShort', { amount: formatCoins(item.priceCoins, locale) })}</span>
                <span className="text-sm text-muted-foreground">{t(`units.${item.unit}`)}</span>
              </span>
            </RadioGroupPrimitive.Item>
          ))}
        </RadioGroupPrimitive.Root>
      </section>

      {cart && cart.item.unit !== 'service' ? <QtyPicker cart={cart} onCart={onCart} /> : null}

      <Card className={cn('flex items-center gap-3 py-3 shadow-lg sm:py-3', STICKY)} data-testid="pay-summary">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm text-muted-foreground">
            {cart && total !== null
              ? t('lineSummary', { name: cart.item.name, qty: qtyLabel(cart.qty, cart.item.unit, locale, (u) => t(`unitShort.${u}`)), price: formatCoins(cart.item.priceCoins, locale) })
              : t('total')}
          </span>
          <span className="text-xl font-bold tabular-nums tracking-tight" data-testid="pay-total" data-total={total ?? ''}>
            {total === null ? '—' : t('coins', { amount: total })}
          </span>
        </div>
        <Button size="lg" trailingIcon={<ArrowRight aria-hidden="true" className="rtl:rotate-180" />} disabled={total === null} onClick={onNext} data-testid="pay-next">
          {t('next')}
        </Button>
      </Card>
    </>
  );
}

function QtyPicker({ cart, onCart }: { cart: NonNullable<Cart>; onCart: (c: Cart) => void }) {
  const t = useTranslations('pay');
  const locale = useLocale();
  const liters = cart.item.unit === 'l';
  const [text, setText] = useState(() => formatQty(cart.qty, locale));
  const [lastQty, setLastQty] = useState(cart.qty);
  // Presets and steppers rewrite the field; typing only updates the cart when it parses.
  if (lastQty !== cart.qty) {
    setLastQty(cart.qty);
    if (parseQty(text) !== cart.qty) setText(formatQty(cart.qty, locale));
  }
  const set = (qty: number) => onCart({ ...cart, qty });

  return (
    <section aria-labelledby="pay-qty-title" className="flex flex-col gap-2">
      <h2 id="pay-qty-title" className="text-base font-semibold">
        {liters ? t('qty.liters') : t('qty.count')}
      </h2>
      {liters ? (
        <div role="group" aria-label={t('qty.presets')} className="grid grid-cols-4 gap-2">
          {[...FUEL_PRESETS_L, FULL_TANK_L].map((v) => {
            const full = v === FULL_TANK_L;
            const active = cart.qty === v;
            return (
              <button
                key={v}
                type="button"
                aria-pressed={active}
                onClick={() => set(v)}
                data-testid={full ? 'pay-preset-full' : `pay-preset-${v}`}
                className={cn(
                  'flex min-h-12 flex-col items-center justify-center rounded-xl px-1 text-[0.9375rem] font-semibold leading-tight transition-colors duration-fast focus-ring',
                  active ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-card text-foreground ring-1 ring-border hover:bg-accent',
                )}
              >
                {full ? (
                  <>
                    <span className="text-sm">{t('qty.fullTank')}</span>
                    <span className={cn('text-xs font-medium', active ? 'text-primary-foreground/85' : 'text-muted-foreground')}>{t('qty.fullTankHint', { liters: FULL_TANK_L })}</span>
                  </>
                ) : (
                  t('qty.litersValue', { value: v })
                )}
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <IconButton variant="outline" aria-label={t('qty.less')} onClick={() => set(stepQty(cart.item.unit, cart.qty, -1))} disabled={cart.qty <= 1}>
          <Minus />
        </IconButton>
        <label className="relative flex-1">
          <span className="sr-only">{liters ? t('qty.liters') : t('qty.count')}</span>
          <input
            value={text}
            inputMode={liters ? 'decimal' : 'numeric'}
            onChange={(e) => {
              setText(e.target.value);
              const v = parseQty(e.target.value);
              if (v !== null && Number.isFinite(v) && v > 0) set(liters ? Math.round(v * 10) / 10 : Math.round(v));
            }}
            data-testid="pay-qty"
            className="h-11 w-full rounded-lg border border-input bg-card pe-10 ps-3 text-center text-base font-semibold tabular-nums focus-ring"
          />
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-muted-foreground">
            {liters ? t('qty.litersUnit') : t('qty.countUnit')}
          </span>
        </label>
        <IconButton variant="outline" aria-label={t('qty.more')} onClick={() => set(stepQty(cart.item.unit, cart.qty, 1))}>
          <Plus />
        </IconButton>
      </div>
    </section>
  );
}

function MethodStep({ point, cart, idempotencyKey, onBack }: { point: PayPointDto; cart: NonNullable<Cart>; idempotencyKey: string; onBack: () => void }) {
  const t = useTranslations('pay');
  const locale = useLocale();
  const router = useRouter();
  const online = useOnlineStatus();
  const wallet = useWallet();
  const order = useCreateOrder();
  const errorMessage = usePayErrorMessage();
  const total = cartTotal(cart)!;
  const balance = wallet.data?.balance ?? null;
  const frozen = wallet.data?.frozen ?? false;
  const enough = balance !== null && balance >= total && !frozen;
  const [method, setMethod] = useState<PayMethod | null>(null);
  const chosen: PayMethod = method ?? (wallet.isPending || enough ? 'coins' : 'google_pay');
  const [error, setError] = useState<unknown>(null);
  const label = useMemo(() => `${point.name}: ${cart.item.name}`, [point.name, cart.item.name]);

  const pay = async (googlePay?: GooglePayResult) => {
    setError(null);
    try {
      const receipt = await order.mutateAsync({
        serviceId: point.serviceId,
        items: [{ itemId: cart.item.id, qty: cart.qty }],
        method: googlePay ? 'google_pay' : 'coins',
        googlePay: googlePay ? { token: googlePay.token, cardNetwork: googlePay.cardNetwork, cardDetails: googlePay.cardDetails } : undefined,
        idempotencyKey,
      });
      router.push(`/pay/orders/${receipt.orderId}?new=1`);
    } catch (err) {
      setError(err);
    }
  };

  return (
    <>
      <Card className="flex flex-col gap-1" data-testid="pay-summary">
        <div className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 break-words text-[0.9375rem] font-medium">
            {cart.item.name}
            {cart.item.unit !== 'service' ? ` · ${qtyLabel(cart.qty, cart.item.unit, locale, (u) => t(`unitShort.${u}`))}` : ''}
          </span>
          <span className="shrink-0 text-2xl font-bold tabular-nums tracking-tight" data-testid="pay-total" data-total={total}>
            {t('coins', { amount: total })}
          </span>
        </div>
        <button type="button" onClick={onBack} className="self-start rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline focus-ring">
          {t('method.change')}
        </button>
      </Card>

      <section aria-labelledby="pay-method-title" className="flex flex-col gap-2">
        <h2 id="pay-method-title" className="text-base font-semibold">
          {t('method.title')}
        </h2>
        <RadioGroup value={chosen} onValueChange={(v) => setMethod(v as PayMethod)} aria-labelledby="pay-method-title" className="flex flex-col gap-2">
          <RadioCard
            value="coins"
            icon={Coins}
            data-testid="pay-method-coins"
            title={t('method.coins')}
            description={
              <span className="flex flex-col gap-0.5">
                <span data-testid="pay-balance" data-balance={balance ?? ''}>
                  {balance === null ? t('method.balanceLoading') : t('method.balance', { amount: balance })}
                </span>
                {frozen ? (
                  <span className="text-warning-soft-foreground">{t('method.frozen')}</span>
                ) : balance !== null && balance < total ? (
                  <span className="text-warning-soft-foreground">{t('method.short', { amount: total - balance })}</span>
                ) : null}
              </span>
            }
          />
          <RadioCard
            value="google_pay"
            icon={CreditCard}
            data-testid="pay-method-gpay"
            title={t('method.gpay')}
            aside={
              <Badge variant="warning" size="sm">
                {t('method.test')}
              </Badge>
            }
            description={t('method.gpayHint')}
          />
        </RadioGroup>
      </section>

      <p className="flex items-start gap-2 rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning-soft-foreground" data-testid="pay-demo-notice">
        <FlaskConical aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {chosen === 'google_pay' ? t('method.gpayDemo') : t('method.coinsDemo')}
      </p>

      {error ? (
        <p role="alert" className="flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger-soft-foreground" data-testid="pay-error">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {errorMessage(error)}
        </p>
      ) : null}

      <div className={cn('rounded-2xl border bg-card p-3 shadow-lg', STICKY)}>
      {chosen === 'coins' ? (
        <div className="flex flex-col gap-2">
          <Button size="lg" fullWidth loading={order.isPending} disabled={!online || !enough} onClick={() => void pay()} data-testid="pay-confirm">
            {t('method.payCoins', { amount: total })}
          </Button>
          {!enough && !frozen && balance !== null ? (
            <Button asChild variant="link" className="self-center">
              <Link href="/wallet">{t('method.topUp')}</Link>
            </Button>
          ) : null}
        </div>
      ) : (
        <GooglePayButton total={total} label={label} disabled={!online} busy={order.isPending} onToken={(r) => void pay(r)} onError={setError} />
      )}
      </div>
    </>
  );
}
