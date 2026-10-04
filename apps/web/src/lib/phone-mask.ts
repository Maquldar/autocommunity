/** Kazakhstan numbers: +7 and 10 national digits, always starting with 7 ("+7 (7XX) XXX-XX-XX"). */
export const KZ_NATIONAL_LENGTH = 10;

/**
 * Extracts up to 10 national digits from whatever is in the field: typed digits,
 * the masked display value, pasted "+7 701 …", domestic "8 701 …", or "7701…".
 */
export function parsePhoneInput(raw: string): string {
  const trimmed = raw.trim();
  const fromMask = trimmed.startsWith('+7');
  let digits = (fromMask ? trimmed.slice(2) : trimmed).replace(/\D/g, '');
  if (digits.length > KZ_NATIONAL_LENGTH) {
    // Raw input: a leading 8 (domestic "8 7XX…") or 7 (country code without "+") is a prefix.
    // Inside the mask, KZ national numbers never start with 8, so only that is a prefix there;
    // any other overflow is an extra keystroke at the end and gets truncated.
    const isPrefix = fromMask ? digits.startsWith('8') : digits.startsWith('7') || digits.startsWith('8');
    if (isPrefix) digits = digits.slice(1);
  }
  return digits.slice(0, KZ_NATIONAL_LENGTH);
}

/** "7011234567" → "+7 (701) 123-45-67"; partial input formats progressively; "" → "". */
export function formatKzPhone(national: string): string {
  const d = national.replace(/\D/g, '').slice(0, KZ_NATIONAL_LENGTH);
  if (!d) return '';
  let out = `+7 (${d.slice(0, 3)}`;
  if (d.length > 3) out += `) ${d.slice(3, 6)}`;
  if (d.length > 6) out += `-${d.slice(6, 8)}`;
  if (d.length > 8) out += `-${d.slice(8, 10)}`;
  return out;
}

/** National digits → E.164 ("+7…"); "" stays "". Partial numbers are returned as typed. */
export function toE164(national: string): string {
  return national ? `+7${national}` : '';
}

/** E.164 value (possibly partial) → national digits. */
export function fromE164(value: string): string {
  return value.startsWith('+7') ? value.slice(2).replace(/\D/g, '').slice(0, KZ_NATIONAL_LENGTH) : '';
}

/** True for a complete Kazakhstan number in E.164 form (+77XXXXXXXXX). */
export function isCompleteKzPhone(value: string): boolean {
  return /^\+77\d{9}$/.test(value);
}
