/**
 * Phase 4 seed: one open SOS near central Almaty (with a photo), one closed SOS where the demo user helped
 * (with its SOS chat), and one expired SOS.
 */
import type { PrismaClient } from '@prisma/client';
import sharp from 'sharp';
import type { Storage } from '../../src/infra/storage/storage';

type SeedUser = { id: string; nickname: string };

const HOUR = 3600_000;
const DAY = 24 * HOUR;

async function insertSos(
  prisma: PrismaClient,
  s: {
    id: string;
    userId: string;
    type: string;
    description: string;
    photoIds: string[];
    lat: number;
    lng: number;
    status: string;
    sharePhone: boolean;
    radiusM: number;
    createdAt: Date;
    acceptedAt: Date | null;
    closedAt: Date | null;
    expiresAt: Date;
  },
): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO sos_requests (id, user_id, type, description, photo_upload_ids, location, status, share_phone, radius_m,
                              created_at, accepted_at, closed_at, expires_at, updated_at)
    VALUES (${s.id}::uuid, ${s.userId}::uuid, ${s.type}::"SosType", ${s.description}, ${s.photoIds}::uuid[],
            ST_SetSRID(ST_MakePoint(${s.lng}::float8, ${s.lat}::float8), 4326)::geography, ${s.status}::"SosStatus",
            ${s.sharePhone}, ${s.radiusM}::int, ${s.createdAt}, ${s.acceptedAt}, ${s.closedAt}, ${s.expiresAt},
            ${s.closedAt ?? s.createdAt})`;
}

export async function seedSos(
  prisma: PrismaClient,
  storage: Storage,
  newId: () => string,
  opts: { now: number; centre: { lat: number; lng: number }; openRequester: SeedUser; demo: SeedUser; closedRequester: SeedUser; expiredRequester: SeedUser },
): Promise<{ sos: number }> {
  const { now, centre } = opts;

  // 1. Open: flat tire ~1 km from the map centre, 12 minutes ago, with a photo.
  const photo = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#3b3f46' } })
    .composite([
      {
        input: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><circle cx="400" cy="330" r="190" fill="#1d1f23"/>` +
            `<circle cx="400" cy="330" r="95" fill="#8b9099"/><text x="400" y="90" font-size="54" text-anchor="middle" fill="#ffffff" ` +
            `font-family="DejaVu Sans, Arial, sans-serif">Пробито колесо</text></svg>`,
        ),
      },
    ])
    .webp({ quality: 80 })
    .toBuffer();
  const thumb = await sharp(photo).resize(400).webp({ quality: 75 }).toBuffer();
  const photoId = newId();
  await storage.put('sos/seed/open.webp', photo, 'image/webp');
  await storage.put('sos/seed/open_t.webp', thumb, 'image/webp');
  await prisma.upload.create({
    data: {
      id: photoId,
      ownerId: opts.openRequester.id,
      purpose: 'sos',
      key: 'sos/seed/open.webp',
      thumbKey: 'sos/seed/open_t.webp',
      mime: 'image/webp',
      sizeBytes: photo.length,
      width: 800,
      height: 600,
      createdAt: new Date(now - 13 * 60_000),
    },
  });
  const openCreated = new Date(now - 12 * 60_000);
  await insertSos(prisma, {
    id: newId(),
    userId: opts.openRequester.id,
    type: 'flat_tire',
    description: 'Пробил колесо на Абая, запаска есть, но не могу открутить болты. Нужен баллонный ключ.',
    photoIds: [photoId],
    lat: centre.lat + 0.006,
    lng: centre.lng + 0.009,
    status: 'created',
    sharePhone: false,
    radiusM: 10000,
    createdAt: openCreated,
    acceptedAt: null,
    closedAt: null,
    expiresAt: new Date(openCreated.getTime() + 2 * HOUR),
  });

  // 2. Closed: dead battery 3 days ago; the demo user helped (arrived), with the SOS chat.
  const closedId = newId();
  const closedCreated = new Date(now - 3 * DAY);
  const t = (min: number) => new Date(closedCreated.getTime() + min * 60_000);
  await insertSos(prisma, {
    id: closedId,
    userId: opts.closedRequester.id,
    type: 'battery',
    description: 'Сел аккумулятор у ТРЦ Mega, нужны провода для прикуривания.',
    photoIds: [],
    lat: centre.lat + 0.0145,
    lng: centre.lng + 0.0331,
    status: 'closed',
    sharePhone: true,
    radiusM: 5000,
    createdAt: closedCreated,
    acceptedAt: t(4),
    closedAt: t(41),
    expiresAt: new Date(closedCreated.getTime() + 2 * HOUR),
  });
  await prisma.sosDispatch.create({ data: { sosId: closedId, userId: opts.demo.id, distanceM: 1800, createdAt: t(0) } });
  await prisma.sosResponse.create({ data: { id: newId(), sosId: closedId, helperId: opts.demo.id, status: 'arrived', createdAt: t(2) } });
  const chatId = newId();
  await prisma.chat.create({ data: { id: chatId, type: 'sos', refId: closedId, createdAt: t(4), lastMessageAt: t(41) } });
  await prisma.chatMember.createMany({
    data: [
      { chatId, userId: opts.closedRequester.id, joinedAt: t(4), lastReadAt: t(41) },
      { chatId, userId: opts.demo.id, joinedAt: t(4), lastReadAt: t(41) },
    ],
  });
  const lines: [min: number, sender: string, type: 'system' | 'text', text: string][] = [
    [4, opts.closedRequester.id, 'system', 'sos.chat_created'],
    [4, opts.closedRequester.id, 'system', `sos.helper_accepted:${opts.demo.nickname}`],
    [6, opts.demo.id, 'text', 'Еду, буду минут через 15. Провода есть.'],
    [7, opts.closedRequester.id, 'text', 'Спасибо! Я на парковке P2, серая Камри.'],
    [22, opts.demo.id, 'system', `sos.helper_arrived:${opts.demo.nickname}`],
    [40, opts.closedRequester.id, 'text', 'Завелась! Огромное спасибо 🙏'],
    [41, opts.closedRequester.id, 'system', 'sos.closed'],
  ];
  await prisma.message.createMany({
    data: lines.map(([min, senderId, type, text], i) => ({ id: newId(), chatId, senderId, type, text, createdAt: new Date(t(min).getTime() + i) })),
  });

  // 3. Expired: nobody answered 5 days ago.
  const expiredCreated = new Date(now - 5 * DAY);
  await insertSos(prisma, {
    id: newId(),
    userId: opts.expiredRequester.id,
    type: 'fuel',
    description: 'Закончился бензин на Капчагайской трассе.',
    photoIds: [],
    lat: 43.38,
    lng: 77.02,
    status: 'expired',
    sharePhone: false,
    radiusM: 20000,
    createdAt: expiredCreated,
    acceptedAt: null,
    closedAt: new Date(expiredCreated.getTime() + 2 * HOUR),
    expiresAt: new Date(expiredCreated.getTime() + 2 * HOUR),
  });
  return { sos: 3 };
}
