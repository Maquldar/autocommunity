import { RATING_FORMULA, type RatingBreakdown, type RatingDto } from '@autoc/shared';

export type BreakdownKey = keyof RatingBreakdown;

export type BreakdownRow = {
  key: BreakdownKey;
  value: number;
  /** The component's possible range, for the bar (penalties are negative-only). */
  min: number;
  max: number;
  /** Share of the bar filled, 0..1 (by magnitude for negative values). */
  fill: number;
  sign: 'positive' | 'negative' | 'zero';
};

const RANGES: Record<BreakdownKey, [number, number]> = {
  base: [0, RATING_FORMULA.base],
  help: [0, RATING_FORMULA.help.cap],
  reviews: [-RATING_FORMULA.reviews.cap, RATING_FORMULA.reviews.cap],
  activity: [0, RATING_FORMULA.activity.cap],
  tenure: [0, RATING_FORMULA.tenure.cap],
  penalties: [-100, 0],
};

const ORDER: BreakdownKey[] = ['base', 'help', 'reviews', 'activity', 'tenure', 'penalties'];

/** The breakdown as display rows in a fixed order, with bar fill relative to each component's cap. */
export function breakdownRows(breakdown: RatingBreakdown): BreakdownRow[] {
  return ORDER.map((key) => {
    const value = breakdown[key];
    const [min, max] = RANGES[key];
    const span = value < 0 ? Math.abs(min) : max;
    return {
      key,
      value,
      min,
      max,
      fill: span === 0 ? 0 : Math.min(1, Math.abs(value) / span),
      sign: value > 0 ? 'positive' : value < 0 ? 'negative' : 'zero',
    };
  });
}

/** "+3.2" / "−10" / "0" (one decimal, typographic minus). */
export function formatPoints(value: number, locale = 'en'): string {
  const rounded = Math.round(value * 10) / 10;
  if (rounded === 0) return '0';
  const text = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(Math.abs(rounded));
  return `${rounded > 0 ? '+' : '−'}${text}`;
}

export type Unlock = { key: 'sosCreate' | 'sosHelp'; min: number; unlocked: boolean };

/** What the rating unlocks (SOS create ≥ 20, help ≥ 30), from the API's thresholds. */
export function unlocks(rating: Pick<RatingDto, 'rating' | 'nextThresholds'>): Unlock[] {
  return [
    { key: 'sosCreate', min: rating.nextThresholds.sosCreate, unlocked: rating.rating >= rating.nextThresholds.sosCreate },
    { key: 'sosHelp', min: rating.nextThresholds.sosHelp, unlocked: rating.rating >= rating.nextThresholds.sosHelp },
  ];
}
