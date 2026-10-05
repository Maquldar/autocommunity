import { Injectable } from '@nestjs/common';
import type { SosResponse, Upload } from '@prisma/client';
import {
  REVIEW_LIMITS,
  SOS_OPEN_STATUSES,
  type Relation,
  type SosDto,
  type SosResponseDto,
  type SosStatus,
  type SosType,
} from '@autoc/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { Storage } from '../../infra/storage/storage';
import { toUploadDto } from '../uploads/upload.mapper';
import { RelationService } from '../users/relation.service';
import { UserViewService, userViewInclude, type UserWithView } from '../users/user-view.service';

export type SosRow = {
  id: string;
  userId: string;
  type: SosType;
  description: string;
  photoUploadIds: string[];
  lat: number;
  lng: number;
  status: SosStatus;
  sharePhone: boolean;
  radiusM: number;
  createdAt: Date;
  closedAt: Date | null;
  expiresAt: Date;
  updatedAt: Date;
};

type Loaded = {
  sos: SosRow;
  requester: UserWithView;
  responses: (SosResponse & { helper: UserWithView; distanceM: number | null })[];
  photos: Upload[];
  chat: { id: string; memberIds: Set<string> } | null;
  /** `${authorId}:${targetId}` of user reviews written for this SOS. */
  reviewed: Set<string>;
};

const ACTIVE_HELP = new Set(['accepted', 'arrived']);
const isOpen = (s: SosStatus) => SOS_OPEN_STATUSES.includes(s);
const roundTo = (m: number | null, step: number) => (m === null ? null : Math.round(m / step) * step);

/**
 * Renders SosDto for a viewer (responses, phones, role and distance depend on who looks). Data shared by all
 * viewers is loaded once per call; viewer-specific parts (distance, relations) are one query each.
 */
@Injectable()
export class SosViewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userView: UserViewService,
    private readonly relations: RelationService,
    private readonly storage: Storage,
  ) {}

  /** SOS rows with coordinates, in the order of `ids`. */
  async loadRows(ids: string[]): Promise<SosRow[]> {
    if (!ids.length) return [];
    const rows = await this.prisma.$queryRaw<SosRow[]>`
      SELECT id, user_id AS "userId", type, description, photo_upload_ids AS "photoUploadIds",
             ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng, status, share_phone AS "sharePhone",
             radius_m AS "radiusM", created_at AS "createdAt", closed_at AS "closedAt", expires_at AS "expiresAt",
             updated_at AS "updatedAt"
      FROM sos_requests WHERE id = ANY(${ids}::uuid[])`;
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.map((id) => byId.get(id)).filter((r): r is SosRow => !!r);
  }

  /** One SOS list for one viewer. `origin` replaces the viewer's last location for distances (/sos/nearby). */
  async toDtos(viewerId: string, ids: string[], origin?: { lat: number; lng: number }): Promise<SosDto[]> {
    const loaded = await this.load(ids);
    const distances = await this.viewerDistances([viewerId], ids, origin);
    const relations = await this.relations.relationsFor(viewerId, this.peopleOf([...loaded.values()]));
    return ids
      .map((id) => loaded.get(id))
      .filter((l): l is Loaded => !!l)
      .map((l) => this.render(viewerId, l, distances.get(`${viewerId}:${l.sos.id}`) ?? null, relations));
  }

  async toDto(viewerId: string, id: string): Promise<SosDto> {
    return (await this.toDtos(viewerId, [id]))[0]!;
  }

  /** One SOS rendered for several viewers (fan-out of `sos:update` / `sos:new`). */
  async forViewers(id: string, viewerIds: string[]): Promise<Map<string, SosDto>> {
    const out = new Map<string, SosDto>();
    const loaded = (await this.load([id])).get(id);
    if (!loaded || !viewerIds.length) return out;
    const distances = await this.viewerDistances(viewerIds, [id]);
    const people = this.peopleOf([loaded]);
    for (const viewerId of viewerIds) {
      const relations = await this.relations.relationsFor(viewerId, people);
      out.set(viewerId, this.render(viewerId, loaded, distances.get(`${viewerId}:${id}`) ?? null, relations));
    }
    return out;
  }

  private peopleOf(loaded: Loaded[]): string[] {
    return [...new Set(loaded.flatMap((l) => [l.sos.userId, ...l.responses.map((r) => r.helperId)]))];
  }

  private async load(ids: string[]): Promise<Map<string, Loaded>> {
    const rows = await this.loadRows(ids);
    if (!rows.length) return new Map();
    const sosIds = rows.map((r) => r.id);
    const photoIds = [...new Set(rows.flatMap((r) => r.photoUploadIds))];
    const [requesters, responses, helperDistances, photos, chats, reviews] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, include: userViewInclude }),
      this.prisma.sosResponse.findMany({
        where: { sosId: { in: sosIds } },
        include: { helper: { include: userViewInclude } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.$queryRaw<{ id: string; d: number | null }[]>`
        SELECT r.id, ST_Distance(ul.location, s.location) AS d
        FROM sos_responses r
        JOIN sos_requests s ON s.id = r.sos_id
        LEFT JOIN user_locations ul ON ul.user_id = r.helper_id
        WHERE r.sos_id = ANY(${sosIds}::uuid[])`,
      photoIds.length ? this.prisma.upload.findMany({ where: { id: { in: photoIds } } }) : Promise.resolve([] as Upload[]),
      this.prisma.chat.findMany({ where: { refId: { in: sosIds }, type: 'sos' }, select: { id: true, refId: true, members: { select: { userId: true } } } }),
      this.prisma.review.findMany({ where: { refId: { in: sosIds }, targetType: 'user' }, select: { authorId: true, targetId: true, refId: true } }),
    ]);
    const requesterById = new Map(requesters.map((u) => [u.id, u]));
    const distById = new Map(helperDistances.map((d) => [d.id, d.d]));
    const photoById = new Map(photos.map((p) => [p.id, p]));
    const chatBySos = new Map(chats.map((c) => [c.refId, { id: c.id, memberIds: new Set(c.members.map((m) => m.userId)) }]));
    const out = new Map<string, Loaded>();
    for (const sos of rows) {
      const requester = requesterById.get(sos.userId);
      if (!requester) continue;
      out.set(sos.id, {
        sos,
        requester,
        responses: responses.filter((r) => r.sosId === sos.id).map((r) => ({ ...r, distanceM: distById.get(r.id) ?? null })),
        photos: sos.photoUploadIds.map((id) => photoById.get(id)).filter((p): p is Upload => !!p),
        chat: chatBySos.get(sos.id) ?? null,
        reviewed: new Set(reviews.filter((r) => r.refId === sos.id).map((r) => `${r.authorId}:${r.targetId}`)),
      });
    }
    return out;
  }

  /** `${viewer}:${sos}` → metres from the viewer's last location (or `origin`). */
  private async viewerDistances(viewerIds: string[], sosIds: string[], origin?: { lat: number; lng: number }): Promise<Map<string, number | null>> {
    const rows = origin
      ? await this.prisma.$queryRaw<{ v: string; s: string; d: number }[]>`
          SELECT ${viewerIds[0]!}::text AS v, s.id::text AS s,
                 ST_Distance(s.location, ST_SetSRID(ST_MakePoint(${origin.lng}::float8, ${origin.lat}::float8), 4326)::geography) AS d
          FROM sos_requests s WHERE s.id = ANY(${sosIds}::uuid[])`
      : await this.prisma.$queryRaw<{ v: string; s: string; d: number }[]>`
          SELECT ul.user_id::text AS v, s.id::text AS s, ST_Distance(s.location, ul.location) AS d
          FROM sos_requests s CROSS JOIN user_locations ul
          WHERE s.id = ANY(${sosIds}::uuid[]) AND ul.user_id = ANY(${viewerIds}::uuid[])`;
    return new Map(rows.map((r) => [`${r.v}:${r.s}`, r.d]));
  }

  private render(viewerId: string, l: Loaded, distance: number | null, relations: Map<string, Relation>): SosDto {
    const { sos } = l;
    const open = isOpen(sos.status);
    const isRequester = viewerId === sos.userId;
    const mine = l.responses.find((r) => r.helperId === viewerId);
    const visibleResponses = isRequester ? l.responses : mine ? [mine] : [];
    const responses: SosResponseDto[] = visibleResponses.map((r) => ({
      id: r.id,
      helper: this.userView.toPublicWithRelation(r.helper, relations.get(r.helperId) ?? 'none'),
      status: r.status,
      // A hidden-mode helper's position must not be inferable: no distance for them.
      distanceM: r.helper.privacyMode === 'hidden' ? null : roundTo(r.distanceM, 100),
      helperPhone: isRequester && open && ACTIVE_HELP.has(r.status) ? (r.helper.phone ?? null) : null,
      createdAt: r.createdAt.toISOString(),
    }));
    const activeHelper = !!mine && ACTIVE_HELP.has(mine.status);
    // Reviews: closed SOS, within the window, requester ↔ helpers who reached `arrived`, one per direction.
    const windowOpen = sos.status === 'closed' && !!sos.closedAt && Date.now() - sos.closedAt.getTime() < REVIEW_LIMITS.windowDays * 24 * 3600 * 1000;
    const candidates = !windowOpen
      ? []
      : isRequester
        ? l.responses.filter((r) => r.status === 'arrived').map((r) => r.helper)
        : mine?.status === 'arrived'
          ? [l.requester]
          : [];
    const reviewTargets = candidates.filter((u) => !l.reviewed.has(`${viewerId}:${u.id}`)).map((u) => this.userView.toMini(u));
    return {
      id: sos.id,
      type: sos.type,
      description: sos.description,
      photos: l.photos.map((p) => toUploadDto(p, this.storage)),
      lat: sos.lat,
      lng: sos.lng,
      status: sos.status,
      requester: this.userView.toPublicWithRelation(l.requester, isRequester ? 'self' : (relations.get(sos.userId) ?? 'none')),
      distanceM: roundTo(distance, 10),
      radiusM: sos.radiusM,
      createdAt: sos.createdAt.toISOString(),
      closedAt: sos.closedAt?.toISOString() ?? null,
      expiresAt: sos.expiresAt.toISOString(),
      responses,
      myRole: isRequester ? 'requester' : mine ? 'helper' : 'viewer',
      contactPhone: open && !isRequester && (sos.sharePhone || activeHelper) ? (l.requester.phone ?? null) : null,
      chatId: l.chat && l.chat.memberIds.has(viewerId) ? l.chat.id : null,
      canReview: reviewTargets.length > 0,
      reviewTargets,
    };
  }
}

