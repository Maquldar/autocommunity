import type { PrismaClient } from '@prisma/client';
import type { Env } from '../../config/env';
import { LocalStorage } from './local-storage';
import { PostgresStorage } from './postgres-storage';
import { S3Storage } from './s3-storage';
import type { Storage } from './storage';

export function createStorage(env: Env, prisma: PrismaClient): Storage {
  if (env.STORAGE_DRIVER === 'postgres') return new PostgresStorage(prisma, env.PUBLIC_MEDIA_URL);
  if (env.STORAGE_DRIVER === 's3') {
    return new S3Storage(
      {
        endpoint: env.S3_ENDPOINT,
        region: env.S3_REGION,
        bucket: env.S3_BUCKET!,
        accessKeyId: env.S3_ACCESS_KEY_ID!,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
        forcePathStyle: env.S3_FORCE_PATH_STYLE,
      },
      env.PUBLIC_MEDIA_URL,
    );
  }
  return new LocalStorage(env.UPLOAD_DIR, env.PUBLIC_MEDIA_URL);
}
