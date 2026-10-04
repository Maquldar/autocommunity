import type { Upload } from '@prisma/client';
import type { UploadDto } from '@autoc/shared';
import type { Storage } from '../../infra/storage/storage';

export function toUploadDto(u: Upload, storage: Storage): UploadDto {
  return {
    id: u.id,
    url: storage.publicUrl(u.key),
    thumbUrl: u.thumbKey ? storage.publicUrl(u.thumbKey) : null,
    mime: u.mime,
    width: u.width,
    height: u.height,
    durationSec: u.durationSec,
    sizeBytes: u.sizeBytes,
  };
}
