import { createHash } from 'node:crypto';
import { IMAGE_PURPOSES, LIMITS, type UploadPurpose } from '@autoc/shared';
import { fromBuffer } from 'file-type';
import sharp from 'sharp';
import { Errors } from '../../common/errors/api-exception';

export type MediaKind = 'image' | 'voice' | 'video';

export type ProcessedMedia = {
  kind: MediaKind;
  mime: string;
  ext: string;
  body: Buffer;
  thumb: Buffer | null;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  contentHash: string;
};

const IMAGE_MAX_PX = 2048;
const THUMB_MAX_PX = 400;

/** Detected (magic-byte) MIME → stored MIME + extension, per media kind. */
const ACCEPTED: Record<MediaKind, Record<string, { mime: string; ext: string }>> = {
  image: {
    'image/jpeg': { mime: 'image/webp', ext: 'webp' },
    'image/png': { mime: 'image/webp', ext: 'webp' },
    'image/webp': { mime: 'image/webp', ext: 'webp' },
    'image/heic': { mime: 'image/webp', ext: 'webp' },
    'image/heif': { mime: 'image/webp', ext: 'webp' },
  },
  voice: {
    // WebM audio is reported as video/webm by magic bytes; ".weba" makes static serving use audio/webm.
    'video/webm': { mime: 'audio/webm', ext: 'weba' },
    'audio/webm': { mime: 'audio/webm', ext: 'weba' },
    'audio/ogg': { mime: 'audio/ogg', ext: 'ogg' },
    'audio/opus': { mime: 'audio/ogg', ext: 'ogg' },
    'audio/mp4': { mime: 'audio/mp4', ext: 'm4a' },
    'audio/x-m4a': { mime: 'audio/mp4', ext: 'm4a' },
    'video/mp4': { mime: 'audio/mp4', ext: 'm4a' },
    'audio/mpeg': { mime: 'audio/mpeg', ext: 'mp3' },
  },
  video: {
    'video/mp4': { mime: 'video/mp4', ext: 'mp4' },
    'video/webm': { mime: 'video/webm', ext: 'webm' },
  },
};

const MAX_BYTES: Record<MediaKind, number> = {
  image: LIMITS.imageMaxBytes,
  voice: LIMITS.voiceMaxBytes,
  video: LIMITS.videoMaxBytes,
};

export const maxBytesFor = (kind: MediaKind): number => MAX_BYTES[kind];

const MAX_SECONDS: Partial<Record<MediaKind, number>> = { voice: LIMITS.voiceMaxSec, video: LIMITS.videoMaxSec };

export function mediaKindFor(purpose: UploadPurpose): MediaKind {
  if (purpose === 'voice') return 'voice';
  if (purpose === 'video') return 'video';
  if ((IMAGE_PURPOSES as readonly string[]).includes(purpose)) return 'image';
  throw new Error(`No media kind for purpose ${purpose}`);
}

export const clampDuration = (kind: MediaKind, durationSec: number | undefined): number | null => {
  const max = MAX_SECONDS[kind];
  if (max === undefined || durationSec === undefined) return null;
  return Math.round(Math.min(Math.max(durationSec, 0), max) * 10) / 10;
};

const sha256 = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');

/**
 * Validates the file by magic bytes and size for the purpose. Images are decoded and re-encoded:
 * EXIF orientation is applied, then all metadata (EXIF/GPS, XMP, ICC) is dropped by re-encoding.
 */
export async function processMedia(purpose: UploadPurpose, input: Buffer, durationSec?: number): Promise<ProcessedMedia> {
  const kind = mediaKindFor(purpose);
  if (input.length > MAX_BYTES[kind]) {
    throw Errors.payloadTooLarge(`File exceeds ${Math.round(MAX_BYTES[kind] / 1024 / 1024)} MB for ${purpose}`);
  }
  const detected = await fromBuffer(input);
  const target = detected ? ACCEPTED[kind][detected.mime] : undefined;
  if (!target) throw Errors.unsupportedMedia(`File type is not allowed for ${purpose}`);

  if (kind !== 'image') {
    return {
      kind,
      ...target,
      body: input,
      thumb: null,
      width: null,
      height: null,
      durationSec: clampDuration(kind, durationSec),
      contentHash: sha256(input),
    };
  }

  try {
    const { data, info } = await sharp(input, { failOn: 'error', limitInputPixels: 64_000_000 })
      .rotate()
      .resize({ width: IMAGE_MAX_PX, height: IMAGE_MAX_PX, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    const thumb = await sharp(data)
      .resize({ width: THUMB_MAX_PX, height: THUMB_MAX_PX, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 75 })
      .toBuffer();
    return {
      kind,
      ...target,
      body: data,
      thumb,
      width: info.width,
      height: info.height,
      durationSec: null,
      contentHash: sha256(data),
    };
  } catch {
    // Corrupt files, decompression bombs and codecs this build can't decode (e.g. HEVC-based HEIC).
    throw Errors.unsupportedMedia('Image could not be decoded; upload a JPEG, PNG or WebP');
  }
}
