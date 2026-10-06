import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { BackgroundTasks } from '../../infra/tasks/background-tasks';
import { UploadsService } from './uploads.service';

/** Uploads nothing references this long after they were made are deleted (row + stored objects). */
export const ORPHAN_UPLOAD_HOURS = 24;
export const UPLOAD_CLEANUP_LOCK_KEY = 'uploads:cleanup:lock';
const HOUR_MS = 3600 * 1000;
const FIRST_RUN_DELAY_MS = 5 * 60 * 1000;
const BATCH = 500;

/**
 * Hourly purge of orphaned uploads (uploaded but never attached to a profile, community, message, post,
 * SOS, service, visit, vehicle or violation) older than 24 h. Works with every storage driver (disk, Postgres, S3): objects
 * go through `Storage.delete`. A Redis lock makes one instance run it per hour.
 */
@Injectable()
export class UploadsCleanupService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(UploadsCleanupService.name);
  private readonly instanceId = randomUUID();
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly tasks: BackgroundTasks,
    private readonly uploads: UploadsService,
  ) {}

  onApplicationBootstrap(): void {
    const run = () => this.tasks.run('Orphan upload cleanup', () => this.runIfDue());
    this.timers.push(setTimeout(run, FIRST_RUN_DELAY_MS), setInterval(run, HOUR_MS));
    for (const t of this.timers) t.unref();
    this.tasks.registerProducer('Orphan upload cleanup timer', () => this.onApplicationShutdown());
  }

  onApplicationShutdown(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  async runIfDue(): Promise<number | null> {
    const won = await this.redis.set(UPLOAD_CLEANUP_LOCK_KEY, this.instanceId, 'PX', HOUR_MS - 5 * 60 * 1000, 'NX');
    return won === 'OK' ? this.purge() : null;
  }

  /** Deletes orphans in batches; returns how many were removed. */
  async purge(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - ORPHAN_UPLOAD_HOURS * HOUR_MS);
    let total = 0;
    let after = '00000000-0000-0000-0000-000000000000';
    for (;;) {
      const rows = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT u.id FROM uploads u
        WHERE u.created_at < ${cutoff} AND u.id > ${after}::uuid
          AND NOT EXISTS (SELECT 1 FROM users x WHERE x.avatar_upload_id = u.id)
          AND NOT EXISTS (SELECT 1 FROM communities x WHERE x.avatar_upload_id = u.id)
          AND NOT EXISTS (SELECT 1 FROM messages x WHERE x.upload_id = u.id)
          AND NOT EXISTS (SELECT 1 FROM posts x WHERE x.media_upload_ids @> ARRAY[u.id])
          AND NOT EXISTS (SELECT 1 FROM sos_requests x WHERE x.photo_upload_ids @> ARRAY[u.id])
          AND NOT EXISTS (SELECT 1 FROM service_centers x WHERE x.photo_upload_ids @> ARRAY[u.id])
          AND NOT EXISTS (SELECT 1 FROM service_visits x WHERE x.upload_id = u.id)
          AND NOT EXISTS (SELECT 1 FROM vehicles x WHERE x.photo_upload_ids @> ARRAY[u.id])
          AND NOT EXISTS (SELECT 1 FROM violations x WHERE x.photo_upload_ids @> ARRAY[u.id])
        ORDER BY u.id
        LIMIT ${BATCH}::int`;
      for (const r of rows) {
        await this.uploads.remove(r.id);
        total++;
      }
      if (rows.length < BATCH) break;
      after = rows[rows.length - 1]!.id;
    }
    if (total) this.logger.log(`Deleted ${total} orphaned uploads older than ${ORPHAN_UPLOAD_HOURS} h`);
    return total;
  }
}
