'use client';

import { PRIVACY_MODES, type PrivacyMode } from '@autoc/shared';
import { EyeOff, Globe, Heart, UsersRound, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { RadioCard, RadioGroup } from '@/components/ui/radio-group';

const ICONS: Record<PrivacyMode, LucideIcon> = { hidden: EyeOff, community: UsersRound, friends: Heart, everyone: Globe };

function isPrivacyMode(value: string): value is PrivacyMode {
  return (PRIVACY_MODES as readonly string[]).includes(value);
}

/** Who can see me on the map. Shared by onboarding step 3 and /settings. */
export function PrivacyModePicker({
  value,
  onChange,
  disabled,
  labelledBy,
}: {
  value: PrivacyMode;
  onChange: (mode: PrivacyMode) => void;
  disabled?: boolean;
  labelledBy: string;
}) {
  const t = useTranslations('privacy');
  return (
    <RadioGroup
      value={value}
      onValueChange={(next) => isPrivacyMode(next) && onChange(next)}
      disabled={disabled}
      aria-labelledby={labelledBy}
    >
      {PRIVACY_MODES.map((mode) => (
        <RadioCard
          key={mode}
          value={mode}
          icon={ICONS[mode]}
          title={t(`${mode}.title`)}
          description={t(`${mode}.description`)}
          aside={
            mode === 'community' ? (
              <Badge variant="primary" size="sm">
                {t('recommended')}
              </Badge>
            ) : null
          }
        />
      ))}
    </RadioGroup>
  );
}
