'use client';

import { ADMIN_ACTIONS, type AdminActionDto, type AdminActionKind } from '@autoc/shared';
import { ScrollText } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/ui/page-header';
import { useAdminAudit } from './api';
import { PagedList, TimeCell, ToneBadge, UserCell } from './ui';

const DANGER: readonly string[] = ['user.block', 'community.delete', 'sos.mark_fake', 'report.confirm', 'user.sos_ban', 'service.reject', 'visit.reject'];

/** `user.block` → `user_block` (next-intl reads dots in keys as nesting). */
export const actionKey = (action: AdminActionKind) => action.replace('.', '_') as ActionMessageKey;
type ActionMessageKey = { [K in AdminActionKind]: K extends `${infer A}.${infer B}` ? `${A}_${B}` : K }[AdminActionKind];

/** Where an audited target lives in the admin panel. */
export function auditTargetHref(a: Pick<AdminActionDto, 'targetType' | 'targetId' | 'targetUser'>): string | null {
  switch (a.targetType) {
    case 'user':
      return `/admin/users/${a.targetId}`;
    case 'sos':
      return `/admin/sos/${a.targetId}`;
    case 'service':
      return `/services/${a.targetId}`;
    default:
      return a.targetUser ? `/admin/users/${a.targetUser.id}` : null;
  }
}

export function ActionList({ items, showTarget = false }: { items: AdminActionDto[]; showTarget?: boolean }) {
  const t = useTranslations('admin.audit');
  return (
    <ul className="overflow-hidden rounded-2xl border bg-card [&>li+li]:border-t" aria-label={t('title')}>
      {items.map((a) => {
        const known = (ADMIN_ACTIONS as readonly string[]).includes(a.action);
        const href = auditTargetHref(a);
        return (
          <li key={a.id} className="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-start md:gap-4" data-testid="audit-row">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <ToneBadge tone={DANGER.includes(a.action) ? 'danger' : 'neutral'}>{known ? t(`actions.${actionKey(a.action as AdminActionKind)}`) : a.action}</ToneBadge>
                <TimeCell iso={a.createdAt} />
                {href ? (
                  <Link href={href} className="rounded text-sm font-medium text-primary underline-offset-4 hover:underline focus-ring">
                    {t('target')}
                  </Link>
                ) : null}
              </div>
              {a.note ? <p className="break-words text-sm">{a.note}</p> : null}
              <p className="text-xs text-muted-foreground">{t('by', { name: a.admin.name || `@${a.admin.nickname}` })}</p>
            </div>
            {showTarget ? <UserCell user={a.targetUser} /> : null}
          </li>
        );
      })}
    </ul>
  );
}

/** /admin/audit — every mutating admin action, newest first. */
export function AuditView({ targetUserId }: { targetUserId?: string }) {
  const t = useTranslations('admin.audit');
  const query = useAdminAudit({ targetUserId });
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('title')} description={t('description')} />
      <PagedList query={query} columns={3} empty={{ icon: ScrollText, title: t('empty') }}>
        {(items) => <ActionList items={items} showTarget />}
      </PagedList>
    </div>
  );
}
