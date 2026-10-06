export const PRIVACY_MODES = ['hidden', 'community', 'friends', 'everyone'] as const;
export type PrivacyMode = (typeof PRIVACY_MODES)[number];

export const USER_ROLES = ['user', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const LOCALES = ['ru', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const UPLOAD_PURPOSES = [
  'avatar',
  'community',
  'sos',
  'message',
  'voice',
  'post',
  'video',
  'service',
  'order',
  /* phase 9 */
  'vehicle',
  'violation',
] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

/** Purposes whose files are images (re-encoded to WebP, EXIF stripped). */
export const IMAGE_PURPOSES: readonly UploadPurpose[] = ['avatar', 'community', 'sos', 'message', 'post', 'service', 'order', 'vehicle', 'violation'];

/** Nicknames nobody can claim through the API (impersonation of staff / the platform). */
export const RESERVED_NICKNAMES: readonly string[] = ['admin', 'support', 'moderator', 'autocommunity', 'system', 'root', 'help'];

export const LIMITS = {
  nicknameMin: 3,
  nicknameMax: 24,
  nameMax: 60,
  bioMax: 300,
  /** Premium doubles it (PREMIUM_PERK_LIMITS). */
  vehiclesPerUser: 5,
  vehiclePhotosMax: 5,
  vehicleDescriptionMax: 500,
  vinLength: 17,
  engineVolumeMinL: 0.6,
  engineVolumeMaxL: 8,
  mileageMaxKm: 2_000_000,
  plateMax: 12,
  vehicleTextMax: 40,
  minVehicleYear: 1950,
  imageMaxBytes: 10 * 1024 * 1024,
  voiceMaxBytes: 5 * 1024 * 1024,
  voiceMaxSec: 180,
  videoMaxBytes: 50 * 1024 * 1024,
  videoMaxSec: 600,
  pageDefault: 20,
  pageMax: 50,
  otpTtlSec: 300,
  otpResendSec: 60,
  otpLength: 6,
  otpMaxAttempts: 5,
  mapMaxUsers: 500,
  locationStaleMin: 15,
  locationMinIntervalSec: 10,
  everyoneGridMeters: 500,
} as const;

export const RATING = {
  start: 50,
  min: 0,
  max: 100,
  sosCreateMin: 20,
  sosHelpMin: 30,
  penaltyReport: -10,
  penaltyFakeSos: -50,
} as const;

/** Pilot is Almaty (SPEC A-1); the rest are major KZ cities for profiles. */
export const CITIES = [
  'Almaty',
  'Astana',
  'Shymkent',
  'Karaganda',
  'Aktobe',
  'Taraz',
  'Pavlodar',
  'Ust-Kamenogorsk',
  'Semey',
  'Atyrau',
  'Kostanay',
  'Kyzylorda',
  'Aktau',
  'Uralsk',
  'Petropavlovsk',
  'Taldykorgan',
  'Turkestan',
  'Konaev',
] as const;

export const DEFAULT_MAP_CENTER = { lat: 43.2389, lng: 76.8897, zoom: 12 } as const; // Almaty

/** Brands common in Kazakhstan with popular models. Free-text brand/model is also accepted. */
export const CAR_BRANDS: Record<string, readonly string[]> = {
  Toyota: ['Camry', 'Corolla', 'RAV4', 'Land Cruiser', 'Land Cruiser Prado', 'Highlander', 'Hilux', 'Fortuner'],
  Lexus: ['RX', 'LX', 'GX', 'ES', 'NX'],
  Hyundai: ['Accent', 'Elantra', 'Sonata', 'Tucson', 'Santa Fe', 'Creta', 'Palisade'],
  Kia: ['Rio', 'Cerato', 'K5', 'Sportage', 'Sorento', 'Seltos'],
  Chevrolet: ['Cobalt', 'Nexia', 'Onix', 'Tracker', 'Captiva', 'Malibu', 'Niva'],
  Lada: ['Granta', 'Vesta', 'Largus', 'Niva Legend', 'Niva Travel', 'XRAY'],
  Volkswagen: ['Polo', 'Jetta', 'Passat', 'Tiguan', 'Touareg'],
  'Mercedes-Benz': ['C-Class', 'E-Class', 'S-Class', 'GLE', 'GLS', 'G-Class', 'Sprinter'],
  BMW: ['3 Series', '5 Series', '7 Series', 'X3', 'X5', 'X7'],
  Audi: ['A4', 'A6', 'Q5', 'Q7', 'Q8'],
  Nissan: ['Almera', 'Qashqai', 'X-Trail', 'Patrol', 'Juke'],
  Mitsubishi: ['Lancer', 'Outlander', 'Pajero', 'Pajero Sport', 'L200', 'ASX'],
  Subaru: ['Forester', 'Outback', 'XV', 'Impreza'],
  Honda: ['Civic', 'Accord', 'CR-V', 'Fit'],
  Mazda: ['3', '6', 'CX-5', 'CX-9'],
  Renault: ['Logan', 'Sandero', 'Duster', 'Kaptur', 'Arkana'],
  Skoda: ['Rapid', 'Octavia', 'Superb', 'Kodiaq', 'Karoq'],
  Ford: ['Focus', 'Mondeo', 'Explorer', 'Ranger', 'Transit'],
  Chery: ['Tiggo 4', 'Tiggo 7 Pro', 'Tiggo 8 Pro', 'Arrizo 8'],
  Haval: ['Jolion', 'F7', 'H6', 'Dargo', 'H9'],
  Geely: ['Coolray', 'Atlas', 'Monjaro', 'Tugella', 'Emgrand'],
  Changan: ['CS35 Plus', 'CS55 Plus', 'UNI-K', 'UNI-V', 'Alsvin'],
  JAC: ['J7', 'JS4', 'S3', 'T6'],
  BYD: ['Song Plus', 'Han', 'Seal', 'Atto 3', 'Tang'],
  Zeekr: ['001', '7X', '009'],
  Li: ['L7', 'L8', 'L9'],
  Tesla: ['Model 3', 'Model Y', 'Model S', 'Model X'],
  UAZ: ['Patriot', 'Hunter', 'Bukhanka'],
  GAZ: ['Gazelle Next', 'Sobol'],
  Porsche: ['Cayenne', 'Macan', 'Panamera', '911'],
  'Land Rover': ['Range Rover', 'Range Rover Sport', 'Defender', 'Discovery'],
  Infiniti: ['QX50', 'QX60', 'QX80'],
  Jeep: ['Grand Cherokee', 'Wrangler', 'Compass'],
};
