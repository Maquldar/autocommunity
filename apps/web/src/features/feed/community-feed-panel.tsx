'use client';

import type { CommunityDto } from '@autoc/shared';
import { useTranslations } from 'next-intl';
import { Composer } from './composer';
import { FeedList } from './feed-list';

/** The community page's Feed tab: members can post here; everyone who can see the community reads. */
export function CommunityFeedPanel({ community }: { community: CommunityDto }) {
  const t = useTranslations('feed');
  const member = community.myMembership?.status === 'active';
  return (
    <div className="flex flex-col gap-4 pt-2" data-testid="community-feed">
      {member ? <Composer communityId={community.id} /> : <p className="text-sm text-muted-foreground">{t('communityJoinToPost')}</p>}
      <FeedList params={{ scope: 'all', communityId: community.id }} emptyDescription={t('empty.community')} />
    </div>
  );
}
