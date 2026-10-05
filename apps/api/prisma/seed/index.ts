/**
 * Development seed: realistic Almaty drivers. Deterministic (fixed RNG seed), idempotent (wipes and
 * recreates all data), and refuses to run in production.
 *
 *   pnpm --filter @autoc/api db:seed
 */
import { PrismaClient, type PrivacyMode } from '@prisma/client';
import { CAR_BRANDS, DEFAULT_MAP_CENTER, RATING } from '@autoc/shared';
import sharp from 'sharp';
import { loadDotEnv, parseEnvOrThrow } from '../../src/config/env';
import { v7 } from 'uuid';
import { createStorage } from '../../src/infra/storage/create-storage';
import { ALMATY_BOUNDS } from '../../src/modules/demo/demo-path';
import { friendPairKey } from '../../src/modules/users/relation.service';
import { WARN_ACTION } from '../../src/modules/users/user-view.service';
import { COMMUNITIES, seedCommunities } from './communities';
import { createRng, type Rng } from './rng';

loadDotEnv();
const env = parseEnvOrThrow();
// `--if-empty`: used on demo deployments at boot; seeds only a database without users and never wipes.
const ifEmpty = process.argv.includes('--if-empty');
if (env.NODE_ENV === 'production' && !(env.DEMO_MODE && ifEmpty)) {
  console.error('Refusing to seed: NODE_ENV=production (only `--if-empty` with DEMO_MODE=true is allowed)');
  process.exit(1);
}

const prisma = new PrismaClient();
const storage = createStorage(env, prisma);
const rng = createRng(20261004);
const NOW = Date.now();
const DAY = 86_400_000;
const ID_EPOCH = Date.UTC(2026, 0, 1);
let idSeq = 0;
/** Deterministic UUID v7 (fixed timestamp sequence + seeded random bits) so ids are stable across runs. */
const newId = () => v7({ msecs: ID_EPOCH + idSeq++, random: rng.bytes(16) });

/* ------------------------------------------------------------------ source data */

type Gender = 'm' | 'f';
type Person = { first: string; last: string; gender: Gender; latin: string };

const FIRST: { name: string; latin: string; gender: Gender }[] = [
  { name: 'Айдар', latin: 'aidar', gender: 'm' },
  { name: 'Нурлан', latin: 'nurlan', gender: 'm' },
  { name: 'Ерлан', latin: 'erlan', gender: 'm' },
  { name: 'Данияр', latin: 'daniyar', gender: 'm' },
  { name: 'Арман', latin: 'arman', gender: 'm' },
  { name: 'Бауыржан', latin: 'baurzhan', gender: 'm' },
  { name: 'Ержан', latin: 'erzhan', gender: 'm' },
  { name: 'Асхат', latin: 'askhat', gender: 'm' },
  { name: 'Тимур', latin: 'timur', gender: 'm' },
  { name: 'Руслан', latin: 'ruslan', gender: 'm' },
  { name: 'Дмитрий', latin: 'dmitry', gender: 'm' },
  { name: 'Алексей', latin: 'alexey', gender: 'm' },
  { name: 'Сергей', latin: 'sergey', gender: 'm' },
  { name: 'Максим', latin: 'maxim', gender: 'm' },
  { name: 'Андрей', latin: 'andrey', gender: 'm' },
  { name: 'Ильяс', latin: 'ilyas', gender: 'm' },
  { name: 'Санжар', latin: 'sanzhar', gender: 'm' },
  { name: 'Мирас', latin: 'miras', gender: 'm' },
  { name: 'Айгерим', latin: 'aigerim', gender: 'f' },
  { name: 'Динара', latin: 'dinara', gender: 'f' },
  { name: 'Асель', latin: 'assel', gender: 'f' },
  { name: 'Жанна', latin: 'zhanna', gender: 'f' },
  { name: 'Мадина', latin: 'madina', gender: 'f' },
  { name: 'Камила', latin: 'kamila', gender: 'f' },
  { name: 'Анна', latin: 'anna', gender: 'f' },
  { name: 'Елена', latin: 'elena', gender: 'f' },
  { name: 'Ольга', latin: 'olga', gender: 'f' },
  { name: 'Дана', latin: 'dana', gender: 'f' },
  { name: 'Алия', latin: 'aliya', gender: 'f' },
  { name: 'Сабина', latin: 'sabina', gender: 'f' },
];

/** Surnames with masculine / feminine forms. */
const LAST: [string, string][] = [
  ['Нурланов', 'Нурланова'],
  ['Сейтказиев', 'Сейтказиева'],
  ['Жумабаев', 'Жумабаева'],
  ['Ахметов', 'Ахметова'],
  ['Касымов', 'Касымова'],
  ['Омаров', 'Омарова'],
  ['Бекмухамедов', 'Бекмухамедова'],
  ['Тулегенов', 'Тулегенова'],
  ['Абдрахманов', 'Абдрахманова'],
  ['Иванов', 'Иванова'],
  ['Смирнов', 'Смирнова'],
  ['Ким', 'Ким'],
  ['Пак', 'Пак'],
  ['Кузнецов', 'Кузнецова'],
  ['Попов', 'Попова'],
  ['Есенов', 'Есенова'],
  ['Мукашев', 'Мукашева'],
  ['Исаев', 'Исаева'],
];

const NICK_SUFFIXES = ['', '_kz', '_almaty', '.drive', '_auto', '02', '_777', '.kz', '_road', '_4x4'];

const BIOS = [
  'Езжу по Алматы каждый день, всегда готов помочь с прикуриванием.',
  'Люблю горы и бездорожье. Медеу, Чимбулак, Кольсай — мои маршруты.',
  'Таксую по вечерам, знаю город как свои пять пальцев.',
  'Есть трос и пусковое устройство в багажнике — пишите, если что.',
  'Автомеханик-любитель, разбираюсь в японцах.',
  'Мама двоих детей, езжу аккуратно 🙂',
  'Путешествую по Казахстану на машине. Следующая цель — Алаколь.',
  'Слежу за машиной сам, меняю масло каждые 8 тыс.',
  'Новичок за рулём, учусь у опытных.',
  'Еду из Астаны в Алматы раз в месяц, могу подсказать трассу.',
  null,
  null,
];

const OTHER_CITIES = ['Astana', 'Shymkent', 'Konaev', 'Taldykorgan', 'Karaganda'];
const POPULAR_BRANDS = ['Toyota', 'Hyundai', 'Kia', 'Chevrolet', 'Lada', 'Lexus', 'Volkswagen', 'Haval', 'Chery', 'Nissan'];
const PLATE_LETTERS = 'ABCDEHKMOPTXYZ';
const AVATAR_COLORS = ['#2f6fde', '#16a34a', '#db2777', '#ea580c', '#7c3aed', '#0891b2', '#ca8a04', '#dc2626'];

/** Almaty city bounds (roughly between the airport, Sayakhat and the foothills). */
const ALMATY = ALMATY_BOUNDS;

/* ------------------------------------------------------------------ generators */

function kzPlate(r: Rng): string {
  const digits = String(r.int(1, 999)).padStart(3, '0');
  const letters = Array.from({ length: 3 }, () => r.pick([...PLATE_LETTERS])).join('');
  return `${digits}${letters}${r.chance(0.85) ? '02' : '05'}`;
}

function vehicleFor(r: Rng) {
  const brand = r.chance(0.75) ? r.pick(POPULAR_BRANDS) : r.pick(Object.keys(CAR_BRANDS));
  const model = r.pick([...CAR_BRANDS[brand]!]);
  return { brand, model, year: r.int(2006, 2025), plate: r.chance(0.8) ? kzPlate(r) : null };
}

function privacyFor(r: Rng): PrivacyMode {
  return r.weighted<PrivacyMode>([
    ['community', 45],
    ['everyone', 25],
    ['friends', 20],
    ['hidden', 10],
  ]);
}

const initials = (p: { first: string; last: string }) => `${p.first[0] ?? ''}${p.last[0] ?? ''}`.toUpperCase();

async function initialsAvatar(text: string, color: string): Promise<{ main: Buffer; thumb: Buffer }> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
    <rect width="512" height="512" fill="${color}"/>
    <text x="50%" y="50%" dy=".35em" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif"
      font-size="210" font-weight="700" fill="#ffffff">${text}</text></svg>`;
  const main = await sharp(Buffer.from(svg)).webp({ quality: 85 }).toBuffer();
  const thumb = await sharp(main).resize(400, 400).webp({ quality: 80 }).toBuffer();
  return { main, thumb };
}

/* ------------------------------------------------------------------ seed */

type SeedUser = {
  id: string;
  phone: string;
  name: string;
  nickname: string;
  role: 'user' | 'admin';
  person: Pick<Person, 'first' | 'last'>;
  city: string;
  bio: string | null;
  rating: number;
  privacyMode: PrivacyMode;
  createdAt: Date;
  withAvatar: boolean;
  vehicles: ReturnType<typeof vehicleFor>[];
  location: { lat: number; lng: number; minutesAgo: number } | null;
};

function buildUsers(): SeedUser[] {
  const users: SeedUser[] = [];
  const nicknames = new Set<string>();

  const fixed = (phone: string, nickname: string, role: 'user' | 'admin', person: { first: string; last: string }) => ({
    id: newId(),
    phone,
    name: `${person.first} ${person.last}`,
    nickname,
    role,
    person,
    city: 'Almaty',
    bio: role === 'admin' ? 'Администратор AutoCommunity.' : 'Демо-аккаунт. Toyota Camry, Алматы.',
    rating: role === 'admin' ? 90 : 64,
    privacyMode: 'community' as PrivacyMode,
    createdAt: new Date(NOW - 200 * DAY),
    withAvatar: true,
    location: { lat: 43.2389, lng: 76.8897, minutesAgo: 2 },
  });
  users.push({ ...fixed('+77000000001', 'admin', 'admin', { first: 'Админ', last: 'Платформы' }), vehicles: [] });
  users.push({
    ...fixed('+77000000002', 'demo', 'user', { first: 'Демо', last: 'Водитель' }),
    vehicles: [{ brand: 'Toyota', model: 'Camry', year: 2019, plate: '702DMO02' }],
    location: { lat: 43.2567, lng: 76.9286, minutesAgo: 1 },
  });
  nicknames.add('admin').add('demo');

  const operators = ['701', '702', '705', '707', '747', '771', '775', '777', '778'];
  for (let i = 0; i < 38; i++) {
    const first = rng.pick(FIRST);
    const lastPair = rng.pick(LAST);
    const last = first.gender === 'm' ? lastPair[0] : lastPair[1];
    let nickname = `${first.latin}${rng.pick(NICK_SUFFIXES)}`;
    while (nicknames.has(nickname)) nickname = `${first.latin}${rng.int(10, 99)}`;
    nicknames.add(nickname);

    const vehicleCount = rng.chance(0.3) ? 2 : 1;
    const inAlmaty = rng.chance(0.85);
    users.push({
      id: newId(),
      phone: `+7${rng.pick(operators)}${String(1_000_000 + i * 7919).slice(-7)}`,
      name: `${first.name} ${last}`,
      nickname,
      role: 'user',
      person: { first: first.name, last },
      city: inAlmaty ? 'Almaty' : rng.pick(OTHER_CITIES),
      bio: rng.pick(BIOS),
      rating: Math.min(RATING.max, Math.max(RATING.min, Math.round(rng.normal(62, 14)))),
      privacyMode: privacyFor(rng),
      createdAt: new Date(NOW - rng.int(3, 330) * DAY - rng.int(0, DAY)),
      withAvatar: i % 2 === 0,
      vehicles: Array.from({ length: vehicleCount }, () => vehicleFor(rng)),
      location:
        inAlmaty && rng.chance(0.9)
          ? {
              lat: rng.float(ALMATY.minLat, ALMATY.maxLat),
              lng: rng.float(ALMATY.minLng, ALMATY.maxLng),
              minutesAgo: rng.int(1, 12),
            }
          : null,
    });
  }
  return users;
}

/**
 * The demo account's surroundings, placed around the map's default centre so every visibility branch shows
 * up on its first screen. Users are addressed by their index in `users.slice(2)`, matching seedFriendships:
 * 0–5 accepted friends, 6–7 requests to demo, 8 a request from demo, 9+ strangers.
 * Communities are seeded afterwards (see communities.ts); index 13 and 8 share the Toyota club with demo.
 */
const DEMO_NEIGHBOURHOOD: { index: number; mode: PrivacyMode; dLat: number; dLng: number; minutesAgo: number }[] = [
  // friends: exact positions (relation "friend"), except the hidden one
  { index: 0, mode: 'friends', dLat: 0.004, dLng: 0.006, minutesAgo: 1 },
  { index: 1, mode: 'community', dLat: -0.006, dLng: 0.003, minutesAgo: 2 },
  { index: 2, mode: 'everyone', dLat: 0.009, dLng: -0.008, minutesAgo: 3 },
  { index: 3, mode: 'friends', dLat: -0.012, dLng: -0.01, minutesAgo: 4 },
  { index: 4, mode: 'community', dLat: 0.015, dLng: 0.014, minutesAgo: 5 },
  { index: 5, mode: 'hidden', dLat: 0.002, dLng: -0.004, minutesAgo: 1 },
  // pending requests: only "everyone" shows, approximately
  { index: 6, mode: 'everyone', dLat: -0.003, dLng: 0.017, minutesAgo: 2 },
  { index: 7, mode: 'friends', dLat: 0.007, dLng: 0.012, minutesAgo: 3 },
  { index: 8, mode: 'community', dLat: -0.009, dLng: -0.015, minutesAgo: 2 },
  // strangers in "everyone" mode: approximate (snapped to the ~500 m grid)
  { index: 9, mode: 'everyone', dLat: 0.018, dLng: -0.02, minutesAgo: 1 },
  { index: 10, mode: 'everyone', dLat: -0.017, dLng: 0.022, minutesAgo: 4 },
  { index: 11, mode: 'everyone', dLat: 0.011, dLng: 0.027, minutesAgo: 6 },
  { index: 12, mode: 'everyone', dLat: -0.021, dLng: -0.026, minutesAgo: 2 },
  // stranger in community mode who shares the (public) Toyota club with demo: approximate, relation "community"
  { index: 13, mode: 'community', dLat: 0.005, dLng: -0.018, minutesAgo: 3 },
  // stranger who shares only with friends: invisible to demo
  { index: 14, mode: 'friends', dLat: -0.014, dLng: 0.008, minutesAgo: 2 },
];

function arrangeDemoNeighbourhood(users: SeedUser[]): void {
  const others = users.slice(2);
  for (const n of DEMO_NEIGHBOURHOOD) {
    const u = others[n.index]!;
    u.privacyMode = n.mode;
    u.city = 'Almaty';
    u.location = { lat: DEFAULT_MAP_CENTER.lat + n.dLat, lng: DEFAULT_MAP_CENTER.lng + n.dLng, minutesAgo: n.minutesAgo };
  }
}

async function wipe(): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations', 'spatial_ref_sys')`;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  // Table names come from the catalog, not from input.
  if (list) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} CASCADE`);
}

async function main(): Promise<void> {
  if (ifEmpty && (await prisma.user.count()) > 0) {
    console.log('Seed skipped: database already has users');
    return;
  }
  const users = buildUsers();
  arrangeDemoNeighbourhood(users);
  await wipe();

  for (const [index, u] of users.entries()) {
    let avatarUploadId: string | null = null;
    if (u.withAvatar) {
      const { main, thumb } = await initialsAvatar(initials(u.person), AVATAR_COLORS[index % AVATAR_COLORS.length]!);
      // Fixed keys so re-running the seed overwrites the same objects instead of leaving orphans.
      const key = `avatar/seed/${String(index).padStart(3, '0')}.webp`;
      const thumbKey = `avatar/seed/${String(index).padStart(3, '0')}_t.webp`;
      await storage.put(key, main, 'image/webp');
      await storage.put(thumbKey, thumb, 'image/webp');
      avatarUploadId = newId();
      await prisma.user.create({ data: baseUser(u) });
      await prisma.upload.create({
        data: {
          id: avatarUploadId,
          ownerId: u.id,
          purpose: 'avatar',
          key,
          thumbKey,
          mime: 'image/webp',
          sizeBytes: main.length,
          width: 512,
          height: 512,
          createdAt: u.createdAt,
        },
      });
      await prisma.user.update({ where: { id: u.id }, data: { avatarUploadId } });
    } else {
      await prisma.user.create({ data: baseUser(u) });
    }

    await prisma.authIdentity.create({
      data: { id: newId(), userId: u.id, provider: 'phone', providerUid: u.phone, createdAt: u.createdAt },
    });
    for (const [vi, v] of u.vehicles.entries()) {
      await prisma.vehicle.create({
        data: { id: newId(), userId: u.id, ...v, isPrimary: vi === 0, createdAt: new Date(u.createdAt.getTime() + (vi + 1) * 60_000) },
      });
    }
    if (u.location) {
      await prisma.$executeRaw`
        INSERT INTO user_locations (user_id, location, accuracy_m, source, updated_at)
        VALUES (${u.id}::uuid, ST_SetSRID(ST_MakePoint(${u.location.lng}::float8, ${u.location.lat}::float8), 4326)::geography,
                ${rng.int(5, 40)}::float8, 'seed', now() - make_interval(mins => ${u.location.minutesAgo}::int))`;
    }
  }

  const friendships = await seedFriendships(users);

  // Communities: demo is active in the Toyota club and the offroad group, and has a pending request to the
  // private "Night Drive". Strangers next to the map centre in community mode share the Toyota club with
  // demo, so they appear on demo's map approximately (public community → relation "community", snapped).
  const others = users.slice(2);
  const toyota = COMMUNITIES.findIndex((c) => c.name.startsWith('Toyota'));
  const offroad = COMMUNITIES.findIndex((c) => c.name.startsWith('Offroad'));
  const night = COMMUNITIES.findIndex((c) => c.isPrivate);
  const communities = await seedCommunities(prisma, rng, newId, {
    now: NOW,
    demo: users[1]!,
    friends: others.slice(0, 6),
    pool: others.filter((u) => u.city === 'Almaty'),
    coMembers: [others[13]!, others[8]!],
    demoActive: [toyota, offroad],
    demoPending: night,
  });

  // One warning on a regular user so the admin/warnings UI has data.
  const admin = users[0]!;
  const warned = users[10]!;
  await prisma.adminAction.create({
    data: {
      id: newId(),
      adminId: admin.id,
      action: WARN_ACTION,
      targetType: 'user',
      targetId: warned.id,
      targetUserId: warned.id,
      note: 'Некорректное поведение в чате сообщества',
    },
  });

  const vehicles = users.reduce((n, u) => n + u.vehicles.length, 0);
  console.log(
    `Seeded ${users.length} users (${users.filter((u) => u.withAvatar).length} with avatars), ${vehicles} vehicles, ` +
      `${users.filter((u) => u.location).length} locations, ${friendships.accepted} friendships, ${friendships.pending} pending requests.`,
  );
  console.log(
    `Seeded ${communities.communities} communities, ${communities.directChats} direct chats, ${communities.messages} messages ` +
      '(demo: member of Toyota Club KZ and Offroad 4x4 Алматы, pending in Night Drive).',
  );
  console.log('Sign in: admin +77000000001, demo +77000000002 (dev OTP code is returned by /auth/otp/request).');
  console.log(
    `Demo map: ${DEMO_NEIGHBOURHOOD.length} users around ${DEFAULT_MAP_CENTER.lat},${DEFAULT_MAP_CENTER.lng} ` +
      '(friends exact; "everyone" strangers and Toyota-club co-members approximate; hidden and friends-only strangers invisible).',
  );
}

function baseUser(u: SeedUser) {
  return {
    id: u.id,
    phone: u.phone,
    phoneVerifiedAt: u.createdAt,
    name: u.name,
    nickname: u.nickname,
    city: u.city,
    bio: u.bio,
    rating: u.rating,
    privacyMode: u.privacyMode,
    receiveSos: u.role === 'admin' ? false : rng.chance(0.85),
    role: u.role,
    locale: 'ru',
    onboardedAt: new Date(u.createdAt.getTime() + 5 * 60_000),
    lastActiveAt: u.location ? new Date(NOW - u.location.minutesAgo * 60_000) : new Date(NOW - rng.int(1, 72) * 3_600_000),
    isSeed: true,
    createdAt: u.createdAt,
  };
}

async function seedFriendships(users: SeedUser[]): Promise<{ accepted: number; pending: number }> {
  const pairs = new Map<string, { requester: SeedUser; addressee: SeedUser; status: 'accepted' | 'pending' }>();
  const add = (requester: SeedUser, addressee: SeedUser, status: 'accepted' | 'pending') => {
    const key = friendPairKey(requester.id, addressee.id);
    if (requester.id !== addressee.id && !pairs.has(key)) pairs.set(key, { requester, addressee, status });
  };

  const demo = users[1]!;
  const others = users.slice(2);
  others.slice(0, 6).forEach((u, i) => (i % 2 ? add(demo, u, 'accepted') : add(u, demo, 'accepted')));
  others.slice(6, 8).forEach((u) => add(u, demo, 'pending'));
  add(demo, others[8]!, 'pending');

  while (pairs.size < 9 + 40) {
    const a = rng.pick(others);
    const b = rng.pick(others);
    add(a, b, rng.chance(0.8) ? 'accepted' : 'pending');
  }

  let accepted = 0;
  for (const [pairKey, p] of pairs) {
    const createdAt = new Date(Math.max(p.requester.createdAt.getTime(), p.addressee.createdAt.getTime()) + rng.int(1, 20) * DAY);
    const created = createdAt.getTime() > NOW ? new Date(NOW - rng.int(1, 48) * 3_600_000) : createdAt;
    if (p.status === 'accepted') accepted++;
    await prisma.friendship.create({
      data: {
        id: newId(),
        requesterId: p.requester.id,
        addresseeId: p.addressee.id,
        pairKey,
        status: p.status,
        createdAt: created,
        acceptedAt: p.status === 'accepted' ? new Date(created.getTime() + rng.int(1, 600) * 60_000) : null,
      },
    });
  }
  return { accepted, pending: pairs.size - accepted };
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
