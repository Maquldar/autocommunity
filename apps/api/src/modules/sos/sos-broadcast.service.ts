import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RealtimeService, sosRoom } from '../realtime/realtime.service';
import { SosViewService } from './sos-view.service';

/**
 * `sos:update` fan-out. The payload is viewer-specific (responses, phones, role), so instead of one emit to
 * the `sos:{id}` room each participant (requester, responders, dispatched users) gets their own rendering
 * on their user room. The room is still joined for room-level features.
 */
@Injectable()
export class SosBroadcastService {
  private readonly logger = new Logger(SosBroadcastService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly view: SosViewService,
    private readonly realtime: RealtimeService,
  ) {}

  async participants(sosId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT user_id::text AS id FROM sos_requests WHERE id = ${sosId}::uuid
      UNION SELECT helper_id::text FROM sos_responses WHERE sos_id = ${sosId}::uuid
      UNION SELECT user_id::text FROM sos_dispatches WHERE sos_id = ${sosId}::uuid`;
    return rows.map((r) => r.id);
  }

  /** Best effort: failures are logged, never thrown into the caller's request. */
  update(sosId: string): void {
    void this.send(sosId, 'sos:update').catch((err: unknown) => this.logger.warn({ err, sosId }, 'sos:update failed'));
  }

  async send(sosId: string, event: 'sos:update' | 'sos:new', only?: string[]): Promise<void> {
    const viewers = only ?? (await this.participants(sosId));
    this.realtime.joinRoom(viewers, sosRoom(sosId));
    const rendered = await this.view.forViewers(sosId, viewers);
    for (const [viewerId, dto] of rendered) this.realtime.emitToUser(viewerId, event, dto);
  }
}
