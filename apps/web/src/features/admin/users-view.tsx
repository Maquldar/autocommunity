'use client';

import { ADMIN_USER_STATUSES, type AdminUserStatus } from '@autoc/shared';
import { Search, UsersRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { RatingBadge } from '@/components/ui/rating-badge';
import { useDebounced } from '@/hooks/use-debounced';
import { useAdminUsers } from './api';
import { FilterSelect, PagedList, TableCard, Td, Th, TimeCell, ToneBadge, UserCell } from './ui';
import { isSosBanned, USER_STATUS_TONE } from './view-models';

/** /admin/users — search by nickname, name or phone digits; filter by status. */
export function UsersView({ initialStatus }: { initialStatus?: AdminUserStatus }) {
  const t = useTranslations('admin.users');
  const tc = useTranslations('admin.common');
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<AdminUserStatus | undefined>(initialStatus);
  const q = useDebounced(input.trim(), 300);
  const query = useAdminUsers({ q: q || undefined, status });
  const searchId = useId();

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('title')} description={t('description')} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={searchId}>{t('search')}</Label>
          <div className="relative">
            <Search aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
            <Input
              id={searchId}
              type="search"
              autoComplete="off"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className="ps-10"
              maxLength={60}
            />
          </div>
        </div>
        <FilterSelect
          label={t('status')}
          value={status}
          onChange={setStatus}
          options={ADMIN_USER_STATUSES.map((s) => ({ value: s, label: tc(`userStatus.${s}`) }))}
          testId="status-filter"
        />
      </div>

      <PagedList query={query} columns={5} empty={{ icon: UsersRound, title: t('empty') }}>
        {(users) => (
          <TableCard label={t('title')}>
            <thead>
              <tr>
                <Th>{t('columns.user')}</Th>
                <Th className="hidden md:table-cell">{t('columns.phone')}</Th>
                <Th>{t('columns.status')}</Th>
                <Th className="hidden sm:table-cell">{t('columns.rating')}</Th>
                <Th className="hidden lg:table-cell">{t('columns.joined')}</Th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} data-testid="admin-user-row">
                  <Td>
                    <UserCell user={u} />
                  </Td>
                  <Td className="hidden whitespace-nowrap tabular-nums md:table-cell">{u.phone ?? '—'}</Td>
                  <Td>
                    <span className="flex flex-wrap gap-1">
                      <ToneBadge tone={USER_STATUS_TONE[u.status]}>{tc(`userStatus.${u.status}`)}</ToneBadge>
                      {u.role === 'admin' ? <ToneBadge tone="primary">{tc('admin')}</ToneBadge> : null}
                      {isSosBanned(u) ? <ToneBadge tone="warning">{tc('sosBanned')}</ToneBadge> : null}
                    </span>
                  </Td>
                  <Td className="hidden sm:table-cell">
                    <RatingBadge rating={u.rating} size="sm" />
                  </Td>
                  <Td className="hidden lg:table-cell">
                    <TimeCell iso={u.createdAt} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableCard>
        )}
      </PagedList>
    </div>
  );
}
