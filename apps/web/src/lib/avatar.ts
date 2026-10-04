/** Number of avatar fallback colours (`--avatar-1` … `--avatar-8` in globals.css). */
export const AVATAR_COLOR_COUNT = 8;

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/**
 * Initials for the avatar fallback: first letter/digit of the first two words that have one,
 * or of a single word. Unicode-aware (Cyrillic, Kazakh); symbols and emoji are skipped.
 */
export function getInitials(name: string | null | undefined): string {
  const chars = (name ?? '')
    .split(/[\s._\-@]+/u)
    .map((word) => Array.from(word).find((char) => LETTER_OR_DIGIT.test(char)))
    .filter((char): char is string => char !== undefined)
    .slice(0, 2);
  return chars.length ? chars.join('').toLocaleUpperCase() : '?';
}

/** 32-bit FNV-1a hash — tiny, fast and stable across runtimes. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Deterministic 1-based colour index for a user/community id. Same id → same colour everywhere. */
export function getAvatarColorIndex(id: string): number {
  return (fnv1a(id) % AVATAR_COLOR_COUNT) + 1;
}
