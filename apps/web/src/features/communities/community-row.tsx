'use client';

import type { CommunityDto } from '@autoc/shared';
import { Globe, Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ListItem } from '@/components/ui/list-item';
import { Skeleton } from '@/components/ui/skeleton';
import { useCityName } from '@/features/profile/city';

/** Privacy shown as icon + word (never colour alone). */
export function PrivacyBadge({ isPrivate, size = 'sm' }: { isPrivate: boolean; size?: 'sm' | 'md' }) {
  const t = useTranslations('communities.privacy');
  return (
    <Badge size={size} variant={isPrivate ? 'outline' : 'neutral'} data-testid="privacy-badge">
      {isPrivate ? <Lock aria-hidden="true" /> : <Globe aria-hidden="true" />}
      {isPrivate ? t('private') : t('public')}
    </Badge>
  );
}

/** Membership status for lists: pending request, or the viewer's role. */
export function MembershipBadge({ community }: { community: Pick<CommunityDto, 'myMembership'> }) {
  const t = useTranslations('communities');
  const membership = community.myMembership;
  if (!membership) return null;
  if (membership.status === 'pending') {
    return (
      <Badge size="sm" variant="warning">
        {t('status.pending')}
      </Badge>
    );
  }
  return (
    <Badge size="sm" variant={membership.role === 'member' ? 'neutral' : 'primary'}>
      {t(`role.${membership.role}`)}
    </Badge>
  );
}

/** One community in a list: square avatar, name, privacy, members · city. Navigates to the community. */
export function CommunityRow({ community, showMembership = false }: { community: CommunityDto; showMembership?: boolean }) {
  const t = useTranslations('communities');
  const cityName = useCityName();
  const meta = [t('members', { count: community.memberCount }), community.city ? cityName(community.city) : null].filter(Boolean).join(' · ');
  return (
    <ListItem
      href={`/communities/${community.id}`}
      leading={<Avatar id={community.id} name={community.name} src={community.avatarUrl} shape="square" size="md" decorative />}
      title={
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate">{community.name}</span>
          {community.isPrivate ? (
            <Lock aria-label={t('privacy.private')} role="img" className="size-4 shrink-0 text-muted-foreground" />
          ) : null}
        </span>
      }
      description={meta}
      trailing={showMembership ? <MembershipBadge community={community} /> : undefined}
    />
  );
}

export function CommunityRowSkeleton() {
  return (
    <div className="flex min-h-16 items-center gap-3 px-4 py-3">
      <Skeleton className="size-10 rounded-xl" />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </div>
  );
}
