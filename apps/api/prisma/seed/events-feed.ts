/**
 * Phase 8 seed: community events (4 upcoming incl. a route and a private one, 1 past) with RSVPs and an
 * event chat, and ~25 Russian feed posts (generated photos, 3 polls) with likes and comments.
 * Called once from `seed/index.ts` after communities exist. Deterministic (own RNG stream).
 */
import type { PrismaClient } from '@prisma/client';
import sharp from 'sharp';
import type { Storage } from '../../src/infra/storage/storage';
import { createRng } from './rng';

export type EventsFeedSeedContext = {
  prisma: PrismaClient;
  storage: Storage;
  newId: () => string;
  now: number;
  /** All seeded users; [0] is the admin, [1] the demo user. */
  users: { id: string; createdAt: Date }[];
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Almaty is UTC+5 all year. */
const ALMATY_OFFSET_H = 5;

/** `days` from now at `hour:minute` Almaty wall-clock time. */
function almatyAt(now: number, days: number, hour: number, minute = 0): Date {
  const d = new Date(now + days * DAY);
  d.setUTCHours(hour - ALMATY_OFFSET_H, minute, 0, 0);
  return d;
}

type EventSpec = {
  community: string;
  title: string;
  description: string;
  place: string;
  lat: number;
  lng: number;
  starts: [days: number, hour: number, minute?: number];
  durationH: number | null;
  route?: [number, number][];
  going: number;
  interested: number;
  /** Demo user's RSVP (only where demo is an active member or the community is public). */
  demo?: 'going' | 'interested';
  chat?: string[];
};

const EVENTS: EventSpec[] = [
  {
    community: 'Toyota Club KZ',
    title: 'Воскресная встреча клуба Toyota',
    description:
      'Собираемся на парковке у Достык Плазы: кофе, обмен опытом по ТО и фото машин. Новички — welcome!\nВозьмите хорошее настроение и вопросы по вариаторам 🙂',
    place: 'Парковка ТРЦ «Достык Плаза», пр. Достык 111',
    lat: 43.2335,
    lng: 76.9565,
    starts: [2, 11],
    durationH: 2,
    going: 9,
    interested: 4,
    demo: 'going',
    chat: ['Всем привет! Я буду на белой Камри 70.', 'Кто сможет захватить пару стаканчиков для кофе?', 'Возьму термос, на всех хватит ☕️'],
  },
  {
    community: 'Offroad 4x4 Алматы',
    title: 'Выезд на Чарынский каньон',
    description:
      'Колонной до Чарына через Кокпек. Сбор в 7:00 у Меги на Розыбакиева, рации на 145.500. Минимальный клиренс — 20 см, трос и компрессор обязательны.',
    place: 'ТРЦ «Мега Алма-Ата», ул. Розыбакиева 247а',
    lat: 43.2018,
    lng: 76.892,
    starts: [5, 7],
    durationH: 14,
    route: [
      [76.892, 43.2018],
      [76.945, 43.2525],
      [77.06, 43.3],
      [77.3, 43.335],
      [77.62, 43.39],
      [78.05, 43.42],
      [78.48, 43.38],
      [78.82, 43.35],
      [79.07, 43.355],
    ],
    going: 7,
    interested: 3,
    demo: 'interested',
  },
  {
    community: 'EV Almaty',
    title: 'EV-встреча: зарядка и запас хода зимой',
    description: 'Обсудим новые быстрые станции на Аль-Фараби и как сохранить запас хода в мороз. Можно будет протестировать адаптеры GB/T ↔ Type 2.',
    place: 'Быстрая зарядка, пр. Аль-Фараби 77',
    lat: 43.2185,
    lng: 76.928,
    starts: [3, 19, 30],
    durationH: 2,
    going: 4,
    interested: 2,
  },
  {
    community: 'Night Drive',
    title: 'Ночной заезд на Кок-Тобе',
    description: 'Закрытый заезд для участников клуба. Стартуем от Арбата, финиш на смотровой Кок-Тобе. Без гонок — только красивые фото города ночью.',
    place: 'Старт: ул. Жибек Жолы, у Арбата',
    lat: 43.2611,
    lng: 76.9409,
    starts: [1, 23],
    durationH: 2,
    route: [
      [76.9409, 43.2611],
      [76.9520, 43.2555],
      [76.9611, 43.2462],
      [76.9705, 43.2389],
      [76.9761, 43.2331],
    ],
    going: 5,
    interested: 1,
  },
  {
    community: 'Land Cruiser Club Almaty',
    title: 'Выезд на Большое Алматинское озеро',
    description: 'Колонна до БАО, фотосессия у озера и пикник. Отчёт и фото — в чате клуба.',
    place: 'Сбор: ТРЦ «Мега», ул. Розыбакиева',
    lat: 43.2018,
    lng: 76.892,
    starts: [-10, 8],
    durationH: 8,
    route: [
      [76.892, 43.2018],
      [76.9, 43.15],
      [76.985, 43.06],
      [76.992, 43.051],
    ],
    going: 8,
    interested: 2,
  },
];

type PollSpec = { question: string; options: string[]; multiple: boolean; votes: number[] };
type PostSpec = {
  community: string | null;
  text: string;
  photos?: { scene: Scene; label: string }[];
  poll?: PollSpec;
  hoursAgo: number;
  demoAuthor?: boolean;
};

type Scene = 'mountains' | 'city' | 'road' | 'lake' | 'night' | 'garage';

const POSTS: PostSpec[] = [
  { community: null, hoursAgo: 1, text: 'На Аль-Фараби в сторону гор снова ремонт, правый ряд закрыт от Навои до Есентая. Объезжайте через Тимирязева.' },
  {
    community: 'Toyota Club KZ',
    hoursAgo: 3,
    text: 'Друзья, какое масло льёте в 2AR-FE зимой? Хочу перейти на 0W-20, но сомневаюсь.',
    poll: { question: 'Какое масло в 2AR-FE на зиму?', options: ['0W-20', '5W-30', '5W-20', 'Что посоветует сервис'], multiple: false, votes: [6, 4, 2, 1] },
  },
  {
    community: 'Offroad 4x4 Алматы',
    hoursAgo: 5,
    text: 'Вчера проехали до Кольсайских озёр. Дорога после Саты разбита, но проходимо. Фото с маршрута 👇 https://example.com/kolsai-report',
    photos: [
      { scene: 'mountains', label: 'Кольсай' },
      { scene: 'road', label: 'Дорога на Саты' },
      { scene: 'lake', label: 'Нижнее озеро' },
    ],
  },
  { community: null, hoursAgo: 7, text: 'Кто знает, где в Алматы нормально делают развал-схождение на 3D-стенде? Машину уводит вправо после замены рулевых тяг.' },
  {
    community: null,
    hoursAgo: 9,
    text: 'Первый снег в горах! На Медеу уже белым-бело, не забудьте про зимнюю резину.',
    photos: [{ scene: 'mountains', label: 'Медеу' }],
  },
  {
    community: 'EV Almaty',
    hoursAgo: 12,
    text: 'Опрос для владельцев электромобилей: где заряжаетесь чаще всего?',
    poll: { question: 'Где вы заряжаетесь чаще всего?', options: ['Дома', 'На работе', 'Быстрые станции', 'ТРЦ'], multiple: true, votes: [5, 2, 4, 3] },
  },
  { community: 'Женщины за рулём Алматы', hoursAgo: 15, text: 'Девочки, посоветуйте автоинструктора для контраварийного вождения. Хочу научиться уверенно ездить зимой.' },
  {
    community: null,
    hoursAgo: 18,
    text: 'Вечерний Алматы с Кок-Тобе. Ради таких видов стоит подниматься даже в пробку 🌃',
    photos: [
      { scene: 'night', label: 'Кок-Тобе' },
      { scene: 'city', label: 'Огни города' },
    ],
  },
  { community: 'Land Cruiser Club Almaty', hoursAgo: 22, text: 'Продаю комплект зимней резины Nokian Hakkapeliitta 265/65 R17, один сезон. Пишите в личку.' },
  {
    community: null,
    hoursAgo: 26,
    text: 'Как вы относитесь к платным парковкам в центре?',
    poll: { question: 'Платные парковки в центре Алматы — это…', options: ['Нормально, меньше хаоса', 'Дорого', 'Не хватает мест всё равно'], multiple: false, votes: [3, 7, 5] },
  },
  { community: 'Toyota Club KZ', hoursAgo: 30, text: 'Поменял лампы ближнего света на светодиодные с линзой — разница огромная, но настраивайте фары, чтобы не слепить встречных!' },
  {
    community: 'Offroad 4x4 Алматы',
    hoursAgo: 34,
    text: 'Новая лебёдка на Ниве, тестировали в карьере за Каскеленом. Держит отлично.',
    photos: [{ scene: 'garage', label: 'Лебёдка' }],
  },
  { community: null, hoursAgo: 40, text: 'Спасибо ребятам из сообщества, которые вчера помогли прикурить на Саина! Пусть у вас всё всегда заводится 🙏' },
  { community: 'EV Almaty', hoursAgo: 46, text: 'Зимой в минус 15 запас хода у Leaf упал примерно на 30%. Включаю подогрев заранее от сети — помогает.' },
  {
    community: null,
    hoursAgo: 52,
    text: 'Утро на Капчагайской трассе. Пустая дорога — лучшая терапия.',
    photos: [{ scene: 'road', label: 'Трасса на Конаев' }],
  },
  { community: 'Женщины за рулём Алматы', hoursAgo: 60, text: 'Напоминаю: в багажнике зимой должны быть щётка, незамерзайка, трос и перчатки. Проверьте сегодня!' },
  { community: 'Night Drive', hoursAgo: 66, text: 'Фото с прошлого заезда загрузила в общий альбом. Следующий — в эту пятницу, детали в событии.' },
  { community: null, hoursAgo: 72, text: 'Где сейчас самый дешёвый АИ-95 в городе? У меня на Helios 245 тг.' },
  {
    community: 'Land Cruiser Club Almaty',
    hoursAgo: 80,
    text: 'Фотоотчёт с выезда на БАО. Вода невероятного цвета!',
    photos: [
      { scene: 'lake', label: 'БАО' },
      { scene: 'mountains', label: 'Перевал' },
      { scene: 'road', label: 'Серпантин' },
      { scene: 'lake', label: 'Пикник' },
    ],
  },
  { community: null, hoursAgo: 90, text: 'Будьте внимательны на Рыскулова у Бакая — там снова открытый люк в правом ряду.' },
  { community: 'Toyota Club KZ', hoursAgo: 100, text: 'Кто ставил сетку в бампер на Камри 70? Поделитесь фото и где делали.', demoAuthor: true },
  { community: null, hoursAgo: 110, text: 'Подскажите хороший детейлинг для полировки фар. Помутнели за три года.' },
  { community: 'Offroad 4x4 Алматы', hoursAgo: 130, text: 'Ищем попутчиков на майские в Алтын-Эмель. Нужен минимум один полноприводный экипаж с запаской.' },
  { community: null, hoursAgo: 150, text: 'Дорогие водители, пропускайте пешеходов на нерегулируемых переходах. Штраф — не главное, главное — жизнь.' },
  {
    community: null,
    hoursAgo: 170,
    text: 'Гараж мечты: наконец-то навёл порядок и повесил инструмент на стену.',
    photos: [{ scene: 'garage', label: 'Гараж' }],
  },
];

const COMMENTS = [
  'Спасибо, очень полезно!',
  'Плюсую, сам так делал.',
  'А где именно? Скиньте точку.',
  'Красота! 😍',
  'Был там на прошлой неделе, всё так.',
  'Отличная идея, присоединюсь.',
  'У меня такая же ситуация была, помог сервис на Рыскулова.',
  'Берегите себя на дорогах!',
  'Подписываюсь, тоже интересно.',
  'Супер, спасибо за инфу 👍',
];

const SCENES: Record<Scene, { sky: [string, string]; ground: string; accent: string }> = {
  mountains: { sky: ['#7fb3e8', '#d9ecff'], ground: '#4b6b4f', accent: '#f4f7fb' },
  city: { sky: ['#f6a96b', '#ffd9a8'], ground: '#40414a', accent: '#ffe08a' },
  road: { sky: ['#8ec5f2', '#e6f3ff'], ground: '#5d6168', accent: '#f2f2f2' },
  lake: { sky: ['#6fb7d9', '#cfeefa'], ground: '#2f8f9d', accent: '#e9fbff' },
  night: { sky: ['#0d1630', '#283d6e'], ground: '#151a26', accent: '#ffd166' },
  garage: { sky: ['#9aa3ad', '#d4d9de'], ground: '#5a5f66', accent: '#e86b3a' },
};

async function scenePhoto(scene: Scene, label: string, variant: number): Promise<{ main: Buffer; thumb: Buffer }> {
  const s = SCENES[scene];
  const shift = (variant % 5) * 40;
  const shapes =
    scene === 'mountains' || scene === 'lake'
      ? `<polygon points="${-100 + shift},620 ${260 + shift},230 ${620 + shift},620" fill="#5b7487"/>
         <polygon points="${380 + shift},620 ${760 + shift},170 ${1180 + shift},620" fill="#6d8698"/>
         <polygon points="${700 + shift},236 ${760 + shift},170 ${822 + shift},240" fill="${s.accent}"/>`
      : scene === 'city' || scene === 'night'
        ? Array.from({ length: 9 }, (_, i) => `<rect x="${i * 140 + (shift % 60)}" y="${300 + ((i * 53 + variant * 31) % 180)}" width="110" height="420" fill="#2b2f3a" opacity="0.9"/>`).join('') +
          Array.from({ length: 40 }, (_, i) => `<rect x="${(i * 97 + shift) % 1200}" y="${380 + ((i * 61) % 260)}" width="12" height="16" fill="${s.accent}" opacity="0.85"/>`).join('')
        : scene === 'garage'
          ? `<rect x="120" y="180" width="960" height="40" fill="#3d4148"/>` +
            Array.from({ length: 8 }, (_, i) => `<rect x="${170 + i * 115}" y="230" width="18" height="${120 + ((i * 37) % 90)}" rx="6" fill="${i % 2 ? s.accent : '#c9ced4'}"/>`).join('')
          : `<polygon points="470,800 560,520 640,520 730,800" fill="#3c3f45"/><rect x="592" y="560" width="16" height="50" fill="${s.accent}"/><rect x="590" y="660" width="20" height="70" fill="${s.accent}"/>`;
  const water = scene === 'lake' ? `<rect y="600" width="1200" height="200" fill="#2a9db3"/><rect y="640" width="1200" height="6" fill="#bfeef7" opacity="0.6"/>` : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
    <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.sky[0]}"/><stop offset="1" stop-color="${s.sky[1]}"/></linearGradient></defs>
    <rect width="1200" height="800" fill="url(#sky)"/>
    ${scene === 'night' ? '<circle cx="980" cy="140" r="46" fill="#f5f0d6"/>' : '<circle cx="1020" cy="130" r="56" fill="#fff6d5" opacity="0.8"/>'}
    <rect y="600" width="1200" height="200" fill="${s.ground}"/>
    ${shapes}${water}
    <rect x="40" y="700" rx="14" width="${Math.max(220, label.length * 26 + 60)}" height="64" fill="#000" opacity="0.35"/>
    <text x="70" y="744" font-family="DejaVu Sans, Arial, sans-serif" font-size="34" font-weight="700" fill="#fff">${label}</text></svg>`;
  const main = await sharp(Buffer.from(svg)).webp({ quality: 80 }).toBuffer();
  const thumb = await sharp(main).resize(400, 267).webp({ quality: 75 }).toBuffer();
  return { main, thumb };
}

export async function seedEventsAndFeed(ctx: EventsFeedSeedContext): Promise<string> {
  const { prisma, storage, newId, now, users } = ctx;
  const rng = createRng(20261008);
  const demo = users[1]!;
  const communities = await prisma.community.findMany({ where: { deletedAt: null }, select: { id: true, name: true, ownerId: true } });
  const byName = new Map(communities.map((c) => [c.name, c]));
  const membersOf = async (communityId: string) =>
    (await prisma.communityMember.findMany({ where: { communityId, status: 'active' }, orderBy: { createdAt: 'asc' }, select: { userId: true, role: true } })).map(
      (m) => m,
    );
  const shuffle = <T>(items: T[]) => [...items].sort(() => rng.next() - 0.5);

  /* ---------------------------------------------------------------- events */
  let eventCount = 0;
  let rsvps = 0;
  for (const spec of EVENTS) {
    const community = byName.get(spec.community);
    if (!community) continue;
    const members = await membersOf(community.id);
    const creator = members.find((m) => m.role === 'moderator')?.userId ?? community.ownerId;
    const startsAt = almatyAt(now, spec.starts[0], spec.starts[1], spec.starts[2] ?? 0);
    const endsAt = spec.durationH ? new Date(startsAt.getTime() + spec.durationH * HOUR) : null;
    const createdAt = new Date(Math.min(now - 2 * HOUR, startsAt.getTime() - 4 * DAY));
    const id = newId();
    await prisma.$executeRaw`
      INSERT INTO events (id, community_id, created_by_id, title, description, place, location, starts_at, ends_at, route,
                          reminder_sent_at, created_at, updated_at)
      VALUES (${id}::uuid, ${community.id}::uuid, ${creator}::uuid, ${spec.title}, ${spec.description}, ${spec.place},
              ST_SetSRID(ST_MakePoint(${spec.lng}::float8, ${spec.lat}::float8), 4326)::geography, ${startsAt}, ${endsAt},
              ${spec.route ? JSON.stringify(spec.route) : null}::jsonb, ${startsAt.getTime() < now ? startsAt : null}, ${createdAt}, ${createdAt})`;
    eventCount++;

    const pool = shuffle(members.map((m) => m.userId).filter((u) => u !== demo.id));
    const going = pool.slice(0, spec.going);
    const interested = pool.slice(spec.going, spec.going + spec.interested);
    const demoMember = members.some((m) => m.userId === demo.id);
    if (spec.demo && demoMember) (spec.demo === 'going' ? going : interested).push(demo.id);
    const rsvpAt = (i: number) => new Date(createdAt.getTime() + (i + 1) * 37 * 60_000);
    await prisma.eventParticipant.createMany({
      data: [
        ...going.map((userId, i) => ({ eventId: id, userId, status: 'going' as const, createdAt: rsvpAt(i) })),
        ...interested.map((userId, i) => ({ eventId: id, userId, status: 'interested' as const, createdAt: rsvpAt(going.length + i) })),
      ],
    });
    await prisma.event.update({ where: { id }, data: { goingCount: going.length } });
    rsvps += going.length + interested.length;

    // The event chat exists once someone is going.
    if (going.length) {
      const chatId = newId();
      const lines = spec.chat ?? [];
      const lastAt = lines.length ? now - 40 * 60_000 : createdAt.getTime();
      await prisma.chat.create({ data: { id: chatId, type: 'event', refId: id, createdAt, lastMessageAt: new Date(lastAt) } });
      await prisma.chatMember.createMany({ data: going.map((userId) => ({ chatId, userId, joinedAt: createdAt, lastReadAt: new Date(now) })) });
      if (lines.length) {
        const speakers = going.filter((u) => u !== demo.id);
        await prisma.message.createMany({
          data: lines.map((text, i) => ({
            id: newId(),
            chatId,
            senderId: speakers[i % speakers.length]!,
            type: 'text' as const,
            text,
            createdAt: new Date(lastAt - (lines.length - 1 - i) * 12 * 60_000),
          })),
        });
      }
    }
  }

  /* ---------------------------------------------------------------- posts */
  const everyone = users.slice(2).map((u) => u.id);
  let photoIndex = 0;
  let postCount = 0;
  let likeCount = 0;
  let commentCount = 0;
  let pollCount = 0;
  for (const spec of POSTS) {
    const community = spec.community ? byName.get(spec.community) : null;
    if (spec.community && !community) continue;
    const members = community ? (await membersOf(community.id)).map((m) => m.userId) : everyone;
    const authorId = spec.demoAuthor ? demo.id : shuffle(members.filter((u) => u !== demo.id))[0]!;
    const createdAt = new Date(now - spec.hoursAgo * HOUR - rng.int(0, 50) * 60_000);
    const id = newId();

    const mediaIds: string[] = [];
    for (const photo of spec.photos ?? []) {
      const { main, thumb } = await scenePhoto(photo.scene, photo.label, photoIndex);
      const key = `post/seed/${String(photoIndex).padStart(3, '0')}.webp`;
      const thumbKey = `post/seed/${String(photoIndex).padStart(3, '0')}_t.webp`;
      photoIndex++;
      await storage.put(key, main, 'image/webp');
      await storage.put(thumbKey, thumb, 'image/webp');
      const uploadId = newId();
      await prisma.upload.create({
        data: { id: uploadId, ownerId: authorId, purpose: 'post', key, thumbKey, mime: 'image/webp', sizeBytes: main.length, width: 1200, height: 800, createdAt },
      });
      mediaIds.push(uploadId);
    }

    // Likes and comments come from people who can see the post (community members for community posts).
    const audience = shuffle(members.filter((u) => u !== authorId));
    const likers = audience.slice(0, rng.int(0, Math.min(12, audience.length)));
    const commenters = audience.slice(0, rng.int(0, Math.min(4, audience.length)));
    await prisma.post.create({
      data: { id, authorId, communityId: community?.id ?? null, text: spec.text, mediaUploadIds: mediaIds, likeCount: likers.length, commentCount: commenters.length, createdAt },
    });
    postCount++;
    if (likers.length) {
      await prisma.postLike.createMany({ data: likers.map((userId, i) => ({ postId: id, userId, createdAt: new Date(createdAt.getTime() + (i + 1) * 9 * 60_000) })) });
      likeCount += likers.length;
    }
    if (commenters.length) {
      await prisma.postComment.createMany({
        data: commenters.map((userId, i) => ({
          id: newId(),
          postId: id,
          authorId: userId,
          text: COMMENTS[(postCount * 3 + i) % COMMENTS.length]!,
          createdAt: new Date(Math.min(now - 60_000, createdAt.getTime() + (i + 1) * 23 * 60_000)),
        })),
      });
      commentCount += commenters.length;
    }

    if (spec.poll) {
      pollCount++;
      const pollId = newId();
      const optionIds = spec.poll.options.map(() => newId());
      // Voters: distinct audience members (never the demo user, so the demo can vote); a multiple-choice voter may pick several.
      const voters = audience.filter((u) => u !== demo.id);
      const votes: { optionId: string; userId: string; pollId: string }[] = [];
      const voted = new Set<string>();
      let v = 0;
      spec.poll.votes.forEach((n, oi) => {
        for (let k = 0; k < n && voters.length; k++) {
          const userId = spec.poll!.multiple ? voters[(oi + k) % voters.length]! : voters[v++ % voters.length]!;
          if (votes.some((x) => x.userId === userId && x.optionId === optionIds[oi])) continue;
          if (!spec.poll!.multiple && voted.has(userId)) continue;
          votes.push({ optionId: optionIds[oi]!, userId, pollId });
          voted.add(userId);
        }
      });
      await prisma.poll.create({
        data: {
          id: pollId,
          postId: id,
          question: spec.poll.question,
          multiple: spec.poll.multiple,
          totalVoters: voted.size,
          options: {
            create: spec.poll.options.map((text, position) => ({
              id: optionIds[position]!,
              text,
              position,
              voteCount: votes.filter((x) => x.optionId === optionIds[position]).length,
            })),
          },
        },
      });
      if (votes.length) await prisma.pollVote.createMany({ data: votes });
    }
  }

  return (
    `${eventCount} events (${rsvps} RSVPs, demo going to the Toyota meetup) and ${postCount} posts ` +
    `(${photoIndex} photos, ${pollCount} polls, ${likeCount} likes, ${commentCount} comments)`
  );
}
