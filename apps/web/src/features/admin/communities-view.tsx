'use client';

import type { AdminCommunityDto } from '@autoc/shared';
import { Search, Trash2, UsersRound } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { useDebounced } from '@/hooks/use-debounced';
import { adminApi, useAdminCommunities, useAdminMutation } from './api';
import { NoteDialog } from './note-dialog';
import { PagedList, TableCard, Td, Th, TimeCell, ToneBadge, UserCell } from './ui';

/** /admin/communities — all communities (deleted ones flagged) with delete. */
export function CommunitiesAdminView() {
  const t = useTranslations('admin.communities');
  const [input, setInput] = useState('');
  const q = useDebounced(input.trim(), 300);
  const query = useAdminCommunities({ q: q || undefined });
  const [deleting, setDeleting] = useState<AdminCommunityDto | null>(null);
  const mutation = useAdminMutation((vars: { id: string; note: string }) => adminApi.deleteCommunity(vars.id, vars.note));
  const searchId = useId();

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('title')} description={t('description')} />
      <div className="flex max-w-md flex-col gap-1.5">
        <Label htmlFor={searchId}>{t('search')}</Label>
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
          <Input id={searchId} type="search" value={input} onChange={(e) => setInput(e.target.value)} className="ps-10" maxLength={60} autoComplete="off" />
        </div>
      </div>
      <PagedList query={query} columns={5} empty={{ icon: UsersRound, title: t('empty') }}>
        {(items) => (
          <TableCard label={t('title')}>
            <thead>
              <tr>
                <Th>{t('columns.name')}</Th>
                <Th className="hidden md:table-cell">{t('columns.owner')}</Th>
                <Th className="hidden sm:table-cell">{t('columns.members')}</Th>
                <Th className="hidden lg:table-cell">{t('columns.created')}</Th>
                <Th>
                  <span className="sr-only">{t('columns.actions')}</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id}>
                  <Td>
                    <span className="flex flex-col gap-1">
                      {c.deleted ? (
                        <span className="font-medium text-muted-foreground line-through">{c.name}</span>
                      ) : (
                        <Link href={`/communities/${c.id}`} className="w-fit rounded font-medium hover:underline focus-ring">
                          {c.name}
                        </Link>
                      )}
                      <span className="flex flex-wrap gap-1">
                        {c.isPrivate ? <ToneBadge tone="outline">{t('private')}</ToneBadge> : null}
                        {c.deleted ? <ToneBadge tone="danger">{t('deleted')}</ToneBadge> : null}
                      </span>
                    </span>
                  </Td>
                  <Td className="hidden md:table-cell">
                    <UserCell user={c.owner} />
                  </Td>
                  <Td className="hidden tabular-nums sm:table-cell">{c.memberCount}</Td>
                  <Td className="hidden lg:table-cell">
                    <TimeCell iso={c.createdAt} />
                  </Td>
                  <Td className="text-end">
                    {c.deleted ? null : (
                      <Button variant="ghost" size="sm" leadingIcon={<Trash2 aria-hidden="true" />} onClick={() => setDeleting(c)} aria-label={t('deleteNamed', { name: c.name })}>
                        <span className="hidden sm:inline">{t('delete')}</span>
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableCard>
        )}
      </PagedList>
      <NoteDialog
        open={deleting !== null}
        onOpenChange={(open) => (open ? undefined : setDeleting(null))}
        tone="danger"
        title={t('deleteTitle', { name: deleting?.name ?? '' })}
        description={t('deleteDescription')}
        confirmLabel={t('delete')}
        successMessage={t('deletedToast')}
        onConfirm={(note) => mutation.mutateAsync({ id: deleting!.id, note })}
      />
    </div>
  );
}
