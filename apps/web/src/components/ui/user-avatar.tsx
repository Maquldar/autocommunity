'use client';

import type { RatingTier } from '@autoc/shared';
import { Award, Crown, Gem, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { hasPremium, resolveTier, TIER_BADGE, TIER_RING, type PremiumUser, type TierUser } from '@/lib/tier';
import { Avatar, type AvatarProps } from './avatar';

export type DecoratedUser = TierUser &
  PremiumUser & {
    id: string;
    name: string;
    avatarUrl?: string | null;
  };

type Size = NonNullable<AvatarProps['size']>;

const RING: Record<Size, { plain: string; framed: string; frame: string; corner: string | null }> = {
  xs: { plain: 'ring-2 ring-offset-1 ring-offset-card', framed: 'ring-1', frame: 'border-2 p-px', corner: null },
  sm: { plain: 'ring-2 ring-offset-1 ring-offset-card', framed: 'ring-2', frame: 'border-2 p-px', corner: null },
  md: { plain: 'ring-2 ring-offset-2 ring-offset-card', framed: 'ring-2', frame: 'border-2 p-0.5', corner: 'size-4 [&_svg]:size-2.5' },
  lg: { plain: 'ring-2 ring-offset-2 ring-offset-card', framed: 'ring-2', frame: 'border-2 p-0.5', corner: 'size-5 [&_svg]:size-3' },
  xl: { plain: 'ring-[3px] ring-offset-[3px] ring-offset-card', framed: 'ring-[3px]', frame: 'border-[3px] p-1', corner: 'size-7 [&_svg]:size-4' },
};

/**
 * A user's avatar with the Phase 9 decorations, used everywhere a person is shown: a ring in the colour
 * of their rating tier (red for "low trust", nothing for the plain tier) and, for premium, a violet frame
 * with a crown in the corner. Colour is never the only signal: pair it with `UserName` / `RatingBadge` /
 * `TierBadge`; the non-decorative variant also announces the tier and premium.
 */
export function UserAvatar({
  user,
  size = 'md',
  decorative = false,
  className,
  frame = true,
}: {
  user: DecoratedUser;
  size?: Size;
  decorative?: boolean;
  className?: string;
  /** Draw the premium frame (default on). */
  frame?: boolean;
}) {
  const t = useTranslations('tiers');
  const tier = resolveTier(user);
  const premium = frame && hasPremium(user);
  const ring = RING[size];
  const tierRing = tier === 'none' ? '' : cn(premium ? ring.framed : ring.plain, TIER_RING[tier]);
  const label = [user.name, premium ? t('premium') : null, tier !== 'none' ? t(`name.${tier}`) : null].filter(Boolean).join(', ');

  const avatar = <Avatar id={user.id} name={user.name || '?'} src={user.avatarUrl ?? null} size={size} decorative className={tierRing} />;

  return (
    <span
      className={cn('relative inline-flex shrink-0 rounded-full', premium && cn('border-premium', ring.frame), className)}
      data-tier={tier}
      data-premium={premium || undefined}
      data-testid="user-avatar"
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative || undefined}
    >
      {avatar}
      {premium && ring.corner ? (
        <span
          aria-hidden="true"
          className={cn('absolute -end-1 -top-1 flex items-center justify-center rounded-full border-2 border-card bg-premium text-premium-foreground', ring.corner)}
        >
          <Crown strokeWidth={2.5} />
        </span>
      ) : null}
      {tier === 'warning' && ring.corner ? (
        <span
          aria-hidden="true"
          className={cn('absolute -bottom-1 -end-1 flex items-center justify-center rounded-full border-2 border-card bg-danger text-danger-foreground', ring.corner)}
        >
          <TriangleAlert strokeWidth={2.5} />
        </span>
      ) : null}
    </span>
  );
}

/** Small crown pill "Premium" (icon + word; `compact` → icon only with an sr-only word). */
export function PremiumBadge({ compact = false, className }: { compact?: boolean; className?: string }) {
  const t = useTranslations('tiers');
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full bg-premium-soft font-semibold text-premium-soft-foreground',
        compact ? 'size-5 justify-center [&_svg]:size-3' : 'h-6 px-2 text-xs [&_svg]:size-3.5',
        className,
      )}
      data-testid="premium-badge"
      title={compact ? t('premium') : undefined}
    >
      <Crown aria-hidden="true" strokeWidth={2.25} />
      {compact ? <span className="sr-only">{t('premium')}</span> : t('premium')}
    </span>
  );
}

const TIER_ICON: Record<Exclude<RatingTier, 'none'>, typeof Award> = {
  warning: TriangleAlert,
  bronze: Award,
  silver: Award,
  gold: Award,
  platinum: Gem,
};

/** Tier pill: icon + word ("Золото", "Низкое доверие"); nothing for the plain tier. */
export function TierBadge({ tier, compact = false, className }: { tier: RatingTier; compact?: boolean; className?: string }) {
  const t = useTranslations('tiers');
  if (tier === 'none') return null;
  const Icon = TIER_ICON[tier];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full font-semibold',
        TIER_BADGE[tier],
        compact ? 'size-5 justify-center [&_svg]:size-3' : 'h-6 px-2 text-xs [&_svg]:size-3.5',
        className,
      )}
      data-testid="tier-badge"
      data-tier={tier}
      title={compact ? t(`name.${tier}`) : undefined}
    >
      <Icon aria-hidden="true" strokeWidth={2.25} />
      {compact ? <span className="sr-only">{t(`name.${tier}`)}</span> : t(`name.${tier}`)}
    </span>
  );
}

/**
 * A person's name with the compact premium crown and (optionally) the compact tier mark. Use it in rows,
 * chats, comments and cards so decorations look the same everywhere.
 */
export function UserName({
  user,
  className,
  showTier = false,
  children,
}: {
  user: DecoratedUser;
  className?: string;
  showTier?: boolean;
  /** Overrides the printed name (e.g. "@nickname" fallbacks). */
  children?: ReactNode;
}) {
  const tier = resolveTier(user);
  return (
    <span className={cn('inline-flex min-w-0 max-w-full items-center gap-1', className)}>
      <span className="truncate">{children ?? user.name}</span>
      {hasPremium(user) ? <PremiumBadge compact /> : null}
      {showTier && tier !== 'none' ? <TierBadge tier={tier} compact /> : null}
    </span>
  );
}
