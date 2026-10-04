import { Injectable, Logger } from '@nestjs/common';
import type { UploadDto, UploadPurpose } from '@autoc/shared';
import type { Upload } from '@prisma/client';
import { Errors } from '../../common/errors/api-exception';
import { newId } from '../../common/ids';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { randomKeyBase, Storage } from '../../infra/storage/storage';
import { processMedia } from './media-processor';
import { toUploadDto } from './upload.mapper';

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: Storage,
  ) {}

  /** Rate limiting and the streaming size cap happen in UploadStreamInterceptor, before buffering. */
  async create(userId: string, purpose: UploadPurpose, file: Buffer, durationSec?: number): Promise<UploadDto> {
    const media = await processMedia(purpose, file, durationSec);

    const base = randomKeyBase(purpose);
    const key = `${base}.${media.ext}`;
    const thumbKey = media.thumb ? `${base}_t.${media.ext}` : null;
    await this.storage.put(key, media.body, media.mime);
    if (thumbKey && media.thumb) await this.storage.put(thumbKey, media.thumb, media.mime);

    try {
      const upload = await this.prisma.upload.create({
        data: {
          id: newId(),
          ownerId: userId,
          purpose,
          key,
          thumbKey,
          mime: media.mime,
          sizeBytes: media.body.length,
          width: media.width,
          height: media.height,
          durationSec: media.durationSec,
          contentHash: media.contentHash,
        },
      });
      return toUploadDto(upload, this.storage);
    } catch (err) {
      await this.removeObjects([key, thumbKey]);
      throw err;
    }
  }

  /**
   * Loads an upload the caller may attach: it must exist, belong to them and match one of the purposes.
   * Same error for every failure so other users' upload ids can't be probed.
   */
  async requireOwn(userId: string, uploadId: string, purposes: UploadPurpose[]): Promise<Upload> {
    const upload = await this.prisma.upload.findUnique({ where: { id: uploadId } });
    if (!upload || upload.ownerId !== userId || !(purposes as string[]).includes(upload.purpose)) {
      throw Errors.badRequest('INVALID_UPLOAD', 'Upload not found or not allowed here');
    }
    return upload;
  }

  /** Deletes an upload row and its stored objects (e.g. a replaced avatar). */
  async remove(uploadId: string): Promise<void> {
    const deleted = await this.prisma.upload
      .delete({ where: { id: uploadId }, select: { key: true, thumbKey: true } })
      .catch(() => null);
    if (deleted) await this.removeObjects([deleted.key, deleted.thumbKey]);
  }

  /** Deletes stored objects; failures are logged, never thrown (orphans are harmless). */
  async removeObjects(keys: (string | null)[]): Promise<void> {
    await Promise.all(
      keys
        .filter((k): k is string => !!k)
        .map((k) => this.storage.delete(k).catch((err: unknown) => this.logger.warn({ err, key: k }, 'Failed to delete object'))),
    );
  }
}
