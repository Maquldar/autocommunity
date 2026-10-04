import type { PrismaClient } from '@prisma/client';
import { Storage, assertSafeKey } from './storage';

/**
 * Keeps file bytes in the `stored_files` table. Meant for demo hosting without a persistent disk
 * (e.g. Render's free tier wipes the filesystem on restart); production should use S3/R2.
 */
export class PostgresStorage extends Storage {
  constructor(
    private readonly prisma: PrismaClient,
    publicBaseUrl: string,
  ) {
    super(publicBaseUrl);
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    assertSafeKey(key);
    // Prisma's Bytes type wants a Uint8Array backed by a plain ArrayBuffer.
    const bytes = new Uint8Array(body);
    await this.prisma.storedFile.upsert({
      where: { key },
      create: { key, contentType, body: bytes },
      update: { contentType, body: bytes },
    });
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    await this.prisma.storedFile.deleteMany({ where: { key } });
  }

  async get(key: string): Promise<{ contentType: string; body: Buffer } | null> {
    try {
      assertSafeKey(key);
    } catch {
      return null;
    }
    const file = await this.prisma.storedFile.findUnique({ where: { key }, select: { contentType: true, body: true } });
    return file ? { contentType: file.contentType, body: Buffer.from(file.body) } : null;
  }
}
