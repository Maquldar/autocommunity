/** "+77272905208" → "+7 727 290 52 08"; other formats are returned unchanged. */
export function formatServicePhone(phone: string): string {
  const m = /^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(phone);
  return m ? `+7 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : phone;
}

/** Distance as a unit-formatted number: metres under 1 km (rounded to 10 m), else km with one decimal. */
export function distanceParts(meters: number): { value: number; unit: 'meter' | 'kilometer' } {
  if (meters < 1000) return { value: Math.max(10, Math.round(meters / 10) * 10), unit: 'meter' };
  return { value: Math.round(meters / 100) / 10, unit: 'kilometer' };
}

/** Deep links to external map apps (open in a new tab; on phones the apps intercept them). */
export const mapLinks = (lat: number, lng: number) => ({
  twoGis: `https://2gis.kz/almaty/geo/${lng},${lat}`,
  google: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
});

/** Rating with one decimal in the viewer's locale ("4,3" in ru). */
export const formatRating = (rating: number, locale: string) =>
  new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(rating);
