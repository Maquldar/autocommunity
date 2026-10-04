import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { beforeAll } from 'vitest';

/** Every test file starts from empty tables and an empty Redis db. */
beforeAll(async () => {
  const prisma = new PrismaClient();
  const redis = new Redis(process.env.REDIS_URL!);
  try {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations', 'spatial_ref_sys')`;
    if (tables.length) {
      const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
      // Table names come from the catalog, not from input.
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
    }
    await redis.flushdb();
  } finally {
    await prisma.$disconnect();
    redis.disconnect();
  }
});
