import { Injectable } from '@nestjs/common';
import webpush from 'web-push';
import type { VapidKeys } from './vapid.service';

export type PushTarget = { endpoint: string; p256dh: string; auth: string };

/** How long push services keep an undelivered message (device offline). */
export const PUSH_TTL_SEC = 24 * 3600;

/**
 * Boundary to the Web Push protocol (tests replace this provider). Throws web-push's `WebPushError`
 * (with `statusCode`) when the push service rejects the message.
 */
@Injectable()
export class WebPushSender {
  async send(target: PushTarget, body: string, vapid: VapidKeys): Promise<void> {
    await webpush.sendNotification(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      body,
      {
        TTL: PUSH_TTL_SEC,
        urgency: 'normal',
        timeout: 10_000,
        vapidDetails: { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
      },
    );
  }
}
