'use client';

import type { Paginated, UserMini } from '@autoc/shared';
import type { InfiniteData } from '@tanstack/react-query';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { useId, type ReactNode, type TdHTMLAttributes, type ThHTMLAttributes } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import type { BadgeTone } from './view-models';

/* ---------- table ---------- */

/** Bordered card holding a table; scrolls horizontally inside itself on narrow screens (never the page). */
export function TableCard({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-x-auto rounded-2xl border bg-card', className)}>
      <table aria-label={label} className="w-full border-collapse text-start text-sm">
        {children}
      </table>
    </div>
  );
}

export function Th({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn('whitespace-nowrap border-b bg-muted/40 px-3 py-2.5 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground', className)}
      {...props}
    />
  );
}

export function Td({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('border-b px-3 py-3 align-middle [tr:last-child>&]:border-b-0', className)} {...props} />;
}

/** Rows shaped like the table while the first page loads. */
export function TableSkeleton({ columns, rows = 6, label }: { columns: number; rows?: number; label: string }) {
  return (
    <div aria-busy="true" className="overflow-hidden rounded-2xl border bg-card">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-4 border-b px-3 py-3 last:border-b-0">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          {Array.from({ length: columns - 1 }, (_, c) => (
            <Skeleton key={c} className={cn('h-4 flex-1', c > 1 && 'hidden md:block')} />
          ))}
        </div>
      ))}
    </div>
  );
}

type InfiniteLike<T> = {
  data: InfiniteData<Paginated<T>, unknown> | undefined;
  status: 'pending' | 'error' | 'success';
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isRefetching: boolean;
  fetchNextPage: () => unknown;
  refetch: () => unknown;
};

/**
 * Loading / error / empty states around a paginated admin list, then the content and a "Load more" button
 * (explicit rather than infinite scroll: moderation queues are worked through deliberately).
 */
export function PagedList<T>({
  query,
  columns,
  empty,
  children,
}: {
  query: InfiniteLike<T>;
  columns: number;
  empty: { icon: LucideIcon; title: ReactNode; description?: ReactNode };
  children: (items: T[]) => ReactNode;
}) {
  const t = useTranslations();
  if (query.status === 'pending') return <TableSkeleton columns={columns} label={t('states.loading')} />;
  if (query.status === 'error') return <ErrorState onRetry={() => void query.refetch()} retrying={query.isRefetching} className="rounded-2xl border bg-card" />;
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  if (!items.length) return <EmptyState {...empty} className="rounded-2xl border bg-card" />;
  return (
    <div className="flex flex-col gap-4">
      {children(items)}
      {query.hasNextPage ? (
        <div className="flex justify-center">
          <Button variant="outline" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
            {t('common.loadMore')}
          </Button>
        </div>
      ) : (
        <p className="text-center text-sm text-muted-foreground">{t('states.end')}</p>
      )}
    </div>
  );
}

/* ---------- cells ---------- */

/** Avatar + name + @nickname; links to the admin user page. */
export function UserCell({ user, href = true, sub }: { user: (Pick<UserMini, 'id' | 'name' | 'avatarUrl'> & { nickname: string | null }) | null; href?: boolean; sub?: ReactNode }) {
  const t = useTranslations('admin');
  if (!user) return <span className="text-muted-foreground">{t('common.noUser')}</span>;
  const label = user.name || (user.nickname ? `@${user.nickname}` : t('common.noName'));
  const content = (
    <>
      <Avatar id={user.id} name={label} src={user.avatarUrl} size="sm" decorative />
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium text-foreground">{label}</span>
        {user.nickname ? <span className="truncate text-xs text-muted-foreground">@{user.nickname}</span> : null}
        {sub}
      </span>
    </>
  );
  return href ? (
    <Link href={`/admin/users/${user.id}`} className="-m-1 flex min-w-0 max-w-64 items-center gap-2.5 rounded-lg p-1 hover:bg-accent focus-ring">
      {content}
    </Link>
  ) : (
    <span className="flex min-w-0 items-center gap-2.5">{content}</span>
  );
}

export function TimeCell({ iso, relative = true }: { iso: string | null; relative?: boolean }) {
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  if (!iso) return <span className="text-muted-foreground">—</span>;
  const date = new Date(iso);
  return (
    <time dateTime={iso} title={format.dateTime(date, { dateStyle: 'medium', timeStyle: 'short' })} className="whitespace-nowrap text-muted-foreground">
      {relative ? format.relativeTime(date, now) : format.dateTime(date, { dateStyle: 'medium', timeStyle: 'short' })}
    </time>
  );
}

export function ToneBadge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return (
    <Badge size="sm" variant={tone}>
      {children}
    </Badge>
  );
}

/* ---------- filters ---------- */

export const ANY = '__any';

/** Labelled select with an "Any" option; `value` undefined = any. */
export function FilterSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  anyLabel,
  testId,
}: {
  label: string;
  value: T | undefined;
  options: readonly { value: T; label: string }[];
  onChange: (value: T | undefined) => void;
  anyLabel?: string;
  testId?: string;
}) {
  const id = useId();
  const t = useTranslations('admin.common');
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value ?? ANY} onValueChange={(next) => onChange(next === ANY ? undefined : (next as T))}>
        <SelectTrigger id={id} data-testid={testId}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{anyLabel ?? t('any')}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Section with a small uppercase heading (detail pages). */
export function Section({ title, children, actions, className }: { title: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn('flex flex-col gap-3', className)}>
      <div className="flex items-center justify-between gap-2">
        <h2 id={id} className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Definition list of label → value pairs. */
export function Facts({ items }: { items: { label: ReactNode; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-2xl border bg-card p-4 sm:grid-cols-2">
      {items.map((item, i) => (
        <div key={i} className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-xs font-medium text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0 break-words text-[0.9375rem]">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
