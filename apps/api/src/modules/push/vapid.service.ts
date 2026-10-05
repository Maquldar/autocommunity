import { Inject, Injectable, Logger } from '@nestjs/common';
import webpush from 'web-push';
import { ENV, type Env } from '../../config/env';
import { PrismaService } from '../../infra/prisma/prisma.service';

export type VapidKeys = { publicKey: string; privateKey: string; subject: string };

export const VAPID_SETTING_KEY = 'vapid';

type StoredKeys = { publicKey: string; privateKey: string };

const isStoredKeys = (v: unknown): v is StoredKeys =>
  typeof v === 'object' && v !== null && typeof (v as StoredKeys).publicKey === 'string' && typeof (v as StoredKeys).privateKey === 'string';

/**
 * VAPID key pair: from env when configured, otherwise generated once and stored in `app_settings` so every
 * instance and restart uses the same pair (subscriptions are bound to the public key).
 */
@Injectable()
export class VapidService {
  private readonly logger = new Logger(VapidService.name);
  private keys: Promise<VapidKeys> | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
  ) {}

  /** Null only when the key pair can't be loaded or generated (e.g. the database is unavailable). */
  async getKeys(): Promise<VapidKeys | null> {
    this.keys ??= this.load();
    try {
      return await this.keys;
    } catch (err) {
      this.keys = null; // retry on the next call
      this.logger.error({ err }, 'Failed to load VAPID keys');
      return null;
    }
  }

  private async load(): Promise<VapidKeys> {
    const subject = this.env.VAPID_SUBJECT;
    if (this.env.VAPID_PUBLIC_KEY && this.env.VAPID_PRIVATE_KEY) {
      return { publicKey: this.env.VAPID_PUBLIC_KEY, privateKey: this.env.VAPID_PRIVATE_KEY, subject };
    }
    const existing = await this.prisma.appSetting.findUnique({ where: { key: VAPID_SETTING_KEY } });
    if (existing && isStoredKeys(existing.value)) return { ...pick(existing.value), subject };

    const generated = webpush.generateVAPIDKeys();
    // Several instances may boot at once: the first insert wins and everyone reads the stored pair back.
    await this.prisma.$executeRaw`
      INSERT INTO app_settings (key, value, created_at, updated_at)
      VALUES (${VAPID_SETTING_KEY}, ${JSON.stringify(pick(generated))}::jsonb, now(), now())
      ON CONFLICT (key) DO NOTHING`;
    const stored = await this.prisma.appSetting.findUniqueOrThrow({ where: { key: VAPID_SETTING_KEY } });
    if (!isStoredKeys(stored.value)) throw new Error(`app_settings.${VAPID_SETTING_KEY} is malformed`);
    if (stored.value.publicKey === generated.publicKey) this.logger.log('Generated and stored a new VAPID key pair');
    return { ...pick(stored.value), subject };
  }
}

const pick = (k: StoredKeys): StoredKeys => ({ publicKey: k.publicKey, privateKey: k.privateKey });

