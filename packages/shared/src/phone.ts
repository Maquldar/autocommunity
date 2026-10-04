/**
 * Normalizes a phone number to E.164. Kazakhstan/Russia numbers written with a
 * leading 8 (domestic format, e.g. "8 701 123 45 67") become +7…
 * Returns null when the input can't be a valid E.164 number.
 */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  const hasPlus = trimmed.startsWith('+');
  let digits = trimmed.replace(/\D/g, '');
  if (!hasPlus) {
    if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
    else if (digits.length === 10 && digits.startsWith('7')) digits = `7${digits}`;
  }
  if (digits.length < 8 || digits.length > 15 || digits.startsWith('0')) return null;
  // +7 covers KZ and RU and always has 10 national digits.
  if (digits.startsWith('7') && digits.length !== 11) return null;
  return `+${digits}`;
}

/** "+77011234567" -> "+7 701 *** ** 67" for display in logs and admin lists. */
export function maskPhone(phone: string): string {
  if (phone.length < 12) return `${phone.slice(0, 3)}*** ${phone.slice(-2)}`;
  return `${phone.slice(0, -10)} ${phone.slice(-10, -7)} *** ** ${phone.slice(-2)}`;
}
