/**
 * Phase 7 seed: ~40 verified fictional service centers across Almaty (all categories), 2 pending submissions,
 * generated photos, verified visits and reviews from seed users, ratings computed with the same Bayesian
 * function the API uses. Called from `seed/index.ts` after users exist.
 */
import type { PrismaClient } from '@prisma/client';
import { bayesianServiceRating, type ServiceCategory, type ServiceHours } from '@autoc/shared';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { Storage } from '../../src/infra/storage/storage';
import type { Rng } from './rng';

export type ServiceSeedContext = {
  prisma: PrismaClient;
  storage: Storage;
  rng: Rng;
  newId: () => string;
  now: number;
  /** All seeded users; [0] is the admin, [1] the demo user. */
  users: { id: string; createdAt: Date }[];
};

const DAY = 86_400_000;

const h = (weekdays: string | null, sat: string | null, sun: string | null): ServiceHours => ({
  mon: weekdays,
  tue: weekdays,
  wed: weekdays,
  thu: weekdays,
  fri: weekdays,
  sat,
  sun,
});
const HOURS = {
  office: h('09:00-19:00', '10:00-16:00', null), // closed on Sundays
  daily: h('09:00-21:00', '09:00-21:00', '10:00-18:00'),
  long: h('08:00-22:00', '08:00-22:00', '08:00-22:00'),
  wash: h('08:00-23:00', '08:00-23:00', '09:00-23:00'),
  parts: h('09:00-18:00', '10:00-15:00', null),
  always: h('00:00-24:00', '00:00-24:00', '00:00-24:00'),
  night: h('10:00-20:00', '10:00-20:00', '20:00-02:00'),
} satisfies Record<string, ServiceHours>;

type SeedService = {
  name: string;
  category: ServiceCategory;
  address: string;
  lat: number;
  lng: number;
  hours: ServiceHours;
  description: string;
  photos?: number;
};

/** Fictional businesses; coordinates sit on the named streets inside the city. */
const SERVICES: SeedService[] = [
  // repair
  { name: 'Автосервис «Тау Мотор»', category: 'repair', address: 'ул. Сейфуллина, 498', lat: 43.2536, lng: 76.9435, hours: HOURS.office, description: 'Диагностика, ремонт ходовой и двигателя. Японские и корейские авто.', photos: 2 },
  { name: 'СТО «Жолдас»', category: 'repair', address: 'пр. Райымбека, 212', lat: 43.2689, lng: 76.9027, hours: HOURS.daily, description: 'Слесарный ремонт, замена масла, развал-схождение.', photos: 1 },
  { name: 'Техцентр «Алатау Сервис»', category: 'repair', address: 'ул. Розыбакиева, 247', lat: 43.2224, lng: 76.8829, hours: HOURS.office, description: 'Официальные регламенты ТО без потери гарантии. Компьютерная диагностика.', photos: 2 },
  { name: 'Мастерская «Гараж 27»', category: 'repair', address: 'ул. Толе би, 286', lat: 43.2497, lng: 76.8601, hours: HOURS.daily, description: 'Ремонт подвески, тормозной системы, сварочные работы.' },
  { name: 'АвтоДок Медеу', category: 'repair', address: 'пр. Достык, 240', lat: 43.2268, lng: 76.9578, hours: HOURS.office, description: 'Автоэлектрик, ремонт кондиционеров, заправка фреона.', photos: 1 },
  { name: 'СТО «Кольцо»', category: 'repair', address: 'ул. Саина, 16', lat: 43.2394, lng: 76.8508, hours: HOURS.long, description: 'Ремонт КПП и сцепления. Работаем без выходных.' },
  { name: 'Сервис «Барыс Авто»', category: 'repair', address: 'ул. Суюнбая, 89', lat: 43.2868, lng: 76.9466, hours: HOURS.office, description: 'Ремонт дизельных двигателей и коммерческого транспорта.', photos: 1 },
  { name: 'Кузовной центр «Арна»', category: 'repair', address: 'ул. Момышулы, 31', lat: 43.2331, lng: 76.8419, hours: HOURS.office, description: 'Кузовной ремонт, покраска в камере, полировка.' },
  { name: 'Автоклиника «Шанырак»', category: 'repair', address: 'ул. Бауыржана Момышулы, 2', lat: 43.2610, lng: 76.8430, hours: HOURS.daily, description: 'Капитальный ремонт двигателей, расточка блоков.' },
  { name: 'СТО «Нурлы Жол»', category: 'repair', address: 'ул. Тлендиева, 133', lat: 43.2783, lng: 76.8822, hours: HOURS.office, description: 'Быстрый шиномонтаж и мелкий ремонт без записи.' },
  { name: 'Сервис «Хайвей»', category: 'repair', address: 'пр. Аль-Фараби, 101', lat: 43.2181, lng: 76.9112, hours: HOURS.long, description: 'Обслуживание гибридов, замена ремня ГРМ.', photos: 1 },
  { name: 'Автотехцентр «Береке»', category: 'repair', address: 'ул. Рыскулова, 57', lat: 43.2949, lng: 76.9071, hours: HOURS.office, description: 'Ремонт рулевых реек, промывка инжектора.' },
  // tires
  { name: 'Шиномонтаж «Колесо 24»', category: 'tires', address: 'пр. Абая, 150', lat: 43.2401, lng: 76.8946, hours: HOURS.always, description: 'Круглосуточный шиномонтаж, балансировка, сезонное хранение шин.', photos: 1 },
  { name: 'Шинный центр «Протектор»', category: 'tires', address: 'ул. Жандосова, 58', lat: 43.2302, lng: 76.8718, hours: HOURS.daily, description: 'Продажа и монтаж шин, правка дисков.', photos: 2 },
  { name: 'Шиномонтаж «Резина+»', category: 'tires', address: 'пр. Суюнбая, 263', lat: 43.3011, lng: 76.9512, hours: HOURS.long, description: 'Монтаж шин до R22, ремонт проколов жгутом и грибком.' },
  { name: 'Вулканизация «Самал»', category: 'tires', address: 'ул. Жолдасбекова, 9', lat: 43.2339, lng: 76.9512, hours: HOURS.office, description: 'Горячая вулканизация, ремонт боковых порезов.' },
  { name: 'Шиномонтаж «Орбита»', category: 'tires', address: 'мкр. Орбита-1, 40', lat: 43.2081, lng: 76.8857, hours: HOURS.daily, description: 'Сезонная переобувка по записи и в живую очередь.' },
  { name: 'ТайрСервис Алмалы', category: 'tires', address: 'ул. Байзакова, 280', lat: 43.2373, lng: 76.9154, hours: HOURS.office, description: 'Азотная подкачка, балансировка грузовых колёс.', photos: 1 },
  { name: 'Шиномонтаж «Восточный»', category: 'tires', address: 'Восточная объездная, 12', lat: 43.2721, lng: 76.9921, hours: HOURS.always, description: 'Круглосуточно у объездной. Выездной шиномонтаж по городу.' },
  { name: 'Колёсный двор «Аксай»', category: 'tires', address: 'мкр. Аксай-3, 25', lat: 43.2283, lng: 76.8296, hours: HOURS.daily, description: 'Шины, диски, хранение. Детская комната ожидания.' },
  // wash
  { name: 'Автомойка «Кристалл»', category: 'wash', address: 'ул. Тимирязева, 42', lat: 43.2252, lng: 76.9009, hours: HOURS.wash, description: 'Бесконтактная мойка, химчистка салона, нанесение воска.', photos: 2 },
  { name: 'Мойка самообслуживания «Wash&Go»', category: 'wash', address: 'ул. Сатпаева, 90', lat: 43.2364, lng: 76.8873, hours: HOURS.always, description: '6 постов самообслуживания, оплата картой и QR.', photos: 1 },
  { name: 'Детейлинг «Блеск»', category: 'wash', address: 'пр. Гагарина, 135', lat: 43.2213, lng: 76.9064, hours: HOURS.office, description: 'Полировка кузова, керамика, оклейка плёнкой.', photos: 1 },
  { name: 'Автомойка «Арман»', category: 'wash', address: 'ул. Шевченко, 165', lat: 43.2465, lng: 76.9011, hours: HOURS.wash, description: 'Мойка кузова и ковриков за 20 минут.' },
  { name: 'Мойка «Пена»', category: 'wash', address: 'ул. Казыбек би, 117', lat: 43.2560, lng: 76.9298, hours: HOURS.night, description: 'Комплексная мойка, работаем вечером в воскресенье.' },
  { name: 'Автомойка «Алтын Су»', category: 'wash', address: 'ул. Жибек Жолы, 50', lat: 43.2610, lng: 76.9405, hours: HOURS.wash, description: 'Мойка двигателя, чистка дисков.' },
  { name: 'Мойка «Северная»', category: 'wash', address: 'ул. Бекмаханова, 96', lat: 43.3052, lng: 76.9203, hours: HOURS.daily, description: 'Мойка грузовых и микроавтобусов.' },
  { name: 'ЭкоМойка «Тастак»', category: 'wash', address: 'ул. Толе би, 189', lat: 43.2511, lng: 76.8876, hours: HOURS.wash, description: 'Мойка без воды — экологичные составы.' },
  // parts
  { name: 'Автозапчасти «Деталь»', category: 'parts', address: 'ул. Райымбека, 349', lat: 43.2673, lng: 76.8671, hours: HOURS.parts, description: 'Запчасти для японских и корейских авто в наличии и под заказ.', photos: 1 },
  { name: 'Магазин «Масло и фильтр»', category: 'parts', address: 'ул. Абылай хана, 74', lat: 43.2560, lng: 76.9460, hours: HOURS.daily, description: 'Моторные масла, фильтры, автохимия.' },
  { name: 'Авторынок «Шыгыс» — павильон 14', category: 'parts', address: 'ул. Бокейханова, 510', lat: 43.2779, lng: 76.9688, hours: HOURS.parts, description: 'Б/у и контрактные запчасти, двигатели и КПП.' },
  { name: 'Автомагазин «Свеча»', category: 'parts', address: 'пр. Абая, 52', lat: 43.2421, lng: 76.9318, hours: HOURS.parts, description: 'Электрика, аккумуляторы, свечи, лампы.', photos: 1 },
  { name: 'Запчасти «Корея Авто»', category: 'parts', address: 'ул. Ауэзова, 175', lat: 43.2351, lng: 76.9041, hours: HOURS.office, description: 'Оригинальные запчасти Hyundai и Kia.' },
  { name: 'Аккумуляторный центр «Ампер»', category: 'parts', address: 'ул. Каблукова, 264', lat: 43.2214, lng: 76.8790, hours: HOURS.daily, description: 'Продажа и бесплатная проверка аккумуляторов, обмен старых.' },
  { name: 'Автостекло «Обзор»', category: 'parts', address: 'ул. Маречека, 7', lat: 43.2025, lng: 76.8932, hours: HOURS.office, description: 'Лобовые стёкла, ремонт сколов.' },
  // tow
  { name: 'Эвакуатор «Алматы 24/7»', category: 'tow', address: 'ул. Ташкентская, 495', lat: 43.2441, lng: 76.8253, hours: HOURS.always, description: 'Круглосуточная эвакуация легковых авто и мотоциклов. Подача от 20 минут.', photos: 1 },
  { name: 'Эвакуатор «Тягач»', category: 'tow', address: 'пр. Суюнбая, 2', lat: 43.2744, lng: 76.9487, hours: HOURS.always, description: 'Эвакуация внедорожников и микроавтобусов, техпомощь на дороге.' },
  { name: 'Техпомощь «Прикурить»', category: 'tow', address: 'ул. Навои, 208', lat: 43.2106, lng: 76.8711, hours: HOURS.long, description: 'Прикурить, подвезти топливо, вскрыть авто.' },
  { name: 'Эвакуатор «Юг»', category: 'tow', address: 'ул. Аль-Фараби, 7', lat: 43.2005, lng: 76.9378, hours: HOURS.always, description: 'Эвакуация с горных дорог: Медеу, Шымбулак, БАО.' },
  { name: 'Манипулятор «Север»', category: 'tow', address: 'ул. Бурундайская, 85', lat: 43.3120, lng: 76.8980, hours: HOURS.daily, description: 'Эвакуация после ДТП, манипулятор до 5 т.' },
];

const PENDING: SeedService[] = [
  { name: 'Шиномонтаж у дома', category: 'tires', address: 'ул. Мынбаева, 46', lat: 43.2311, lng: 76.9265, hours: HOURS.daily, description: 'Небольшой шиномонтаж во дворе, быстро и недорого.' },
  { name: 'Автомойка «Чистый город»', category: 'wash', address: 'ул. Утеген батыра, 73', lat: 43.2275, lng: 76.8562, hours: HOURS.wash, description: 'Новая мойка, открылись в сентябре.' },
];

const REVIEW_TEXTS: Record<number, (string | null)[]> = {
  5: ['Сделали быстро и аккуратно, цена как договаривались.', 'Отличные мастера, всё объяснили и показали старые детали.', 'Лучший сервис в районе, теперь только сюда.', null],
  4: ['Хорошо, но пришлось подождать в очереди около часа.', 'Качественно, немного дороже, чем у других.', null],
  3: ['Нормально, но мастер был не очень вежлив.', 'Сделали, но с опозданием на день.'],
  2: ['Пришлось переделывать, первый раз не докрутили.'],
  1: ['Не рекомендую — навязывали лишние работы.'],
};

const CATEGORY_COLORS: Record<ServiceCategory, [string, string]> = {
  repair: ['#1f5ae0', '#173f9c'],
  tires: ['#6d3fc0', '#472884'],
  wash: ['#0f7ea3', '#0b5872'],
  parts: ['#5f6d1c', '#3f4812'],
  tow: ['#b4570b', '#7d3c06'],
};
const CATEGORY_GLYPH: Record<ServiceCategory, string> = {
  // Simple line drawings (wrench, tyre, droplet, gear, truck) in a 120×120 box.
  repair: '<path d="M78 30a22 22 0 0 0-27 28L28 81a8 8 0 0 0 11 11l23-23a22 22 0 0 0 28-27l-13 13-11-3-3-11z"/>',
  tires: '<circle cx="60" cy="60" r="34"/><circle cx="60" cy="60" r="14"/><path d="M60 26v20M60 74v20M26 60h20M74 60h20"/>',
  wash: '<path d="M60 22c14 20 26 34 26 48a26 26 0 0 1-52 0c0-14 12-28 26-48z"/>',
  parts: '<circle cx="60" cy="60" r="16"/><path d="M60 24v14M60 82v14M24 60h14M82 60h14M35 35l10 10M75 75l10 10M85 35 75 45M45 75 35 85"/>',
  tow: '<path d="M18 78V50h40v28M58 60h22l14 18H58M18 78h76"/><circle cx="34" cy="82" r="8"/><circle cx="78" cy="82" r="8"/>',
};

async function servicePhoto(category: ServiceCategory, variant: number): Promise<{ main: Buffer; thumb: Buffer }> {
  const [from, to] = CATEGORY_COLORS[category];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>
    <rect width="1200" height="800" fill="url(#g)"/>
    <g fill="#ffffff" opacity="0.08">
      <rect x="${80 + variant * 60}" y="420" width="420" height="300" rx="24"/>
      <rect x="${560 - variant * 40}" y="300" width="560" height="420" rx="24"/>
    </g>
    <g transform="translate(450 180) scale(2.5)" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" opacity="0.9">
      ${CATEGORY_GLYPH[category]}
    </g></svg>`;
  const main = await sharp(Buffer.from(svg)).webp({ quality: 80 }).toBuffer();
  const thumb = await sharp(main).resize(400, 267).webp({ quality: 75 }).toBuffer();
  return { main, thumb };
}

/** Deterministic per-service secret so printed QR codes survive a reseed. */
const qrSecretFor = (name: string) => createHash('sha256').update(`seed-qr:${name}`).digest('hex');

export async function seedServices(ctx: ServiceSeedContext): Promise<string> {
  const { prisma, storage, rng, newId, now, users } = ctx;
  const admin = users[0]!;
  const demo = users[1]!;
  const reviewers = users.slice(2);
  const ids: string[] = [];
  let photoCount = 0;

  const insert = async (s: SeedService, index: number, status: 'verified' | 'pending', submittedById: string) => {
    const id = newId();
    const photoIds: string[] = [];
    for (let p = 0; p < (s.photos ?? 0); p++) {
      const { main, thumb } = await servicePhoto(s.category, p + index);
      const key = `service/seed/${String(index).padStart(3, '0')}_${p}.webp`;
      const thumbKey = `service/seed/${String(index).padStart(3, '0')}_${p}_t.webp`;
      await storage.put(key, main, 'image/webp');
      await storage.put(thumbKey, thumb, 'image/webp');
      const uploadId = newId();
      await prisma.upload.create({
        data: { id: uploadId, ownerId: admin.id, purpose: 'service', key, thumbKey, mime: 'image/webp', sizeBytes: main.length, width: 1200, height: 800 },
      });
      photoIds.push(uploadId);
      photoCount++;
    }
    const phone = `+7727${String(2_000_000 + index * 37_717).slice(-7)}`;
    const createdAt = new Date(now - (status === 'pending' ? rng.int(1, 3) : rng.int(30, 400)) * DAY);
    await prisma.$executeRaw`
      INSERT INTO service_centers (id, name, category, description, address, phone, hours, photo_upload_ids, location, rating,
                                   status, qr_secret, submitted_by_id, created_at, updated_at)
      VALUES (${id}::uuid, ${s.name}, ${s.category}::"ServiceCategory", ${s.description}, ${s.address}, ${phone},
              ${JSON.stringify(s.hours)}::jsonb, ${photoIds}::uuid[],
              ST_SetSRID(ST_MakePoint(${s.lng}::float8, ${s.lat}::float8), 4326)::geography, ${bayesianServiceRating(0, 0)}::float8,
              ${status}::"ServiceStatus", ${qrSecretFor(s.name)}, ${submittedById}::uuid, ${createdAt}, ${createdAt})`;
    return id;
  };

  for (const [i, s] of SERVICES.entries()) ids.push(await insert(s, i, 'verified', admin.id));
  await insert(PENDING[0]!, SERVICES.length, 'pending', demo.id);
  await insert(PENDING[1]!, SERVICES.length + 1, 'pending', reviewers[3]!.id);

  // Visits and reviews: every other service gets 1–5 reviews; some extra visits without a review.
  let reviewCount = 0;
  let visitCount = 0;
  for (const [i, serviceId] of ids.entries()) {
    const reviewed = i % 2 === 0 ? rng.int(1, 5) : 0;
    const extraVisits = rng.int(0, 3);
    const pool = [...reviewers];
    for (let k = 0; k < reviewed + extraVisits && pool.length; k++) {
      const author = pool.splice(rng.int(0, pool.length - 1), 1)[0]!;
      const visitedAt = new Date(now - rng.int(2, 120) * DAY - rng.int(0, DAY));
      const visitId = newId();
      await prisma.serviceVisit.create({
        data: {
          id: visitId,
          userId: author.id,
          serviceId,
          method: rng.chance(0.75) ? 'geo' : 'qr',
          distanceM: rng.int(8, 120),
          status: 'verified',
          createdAt: visitedAt,
        },
      });
      visitCount++;
      if (k < reviewed) {
        // Mostly positive, a few critical reviews so ratings spread out.
        const stars = rng.weighted<number>([[5, 45], [4, 30], [3, 12], [2, 8], [1, 5]]);
        await prisma.review.create({
          data: {
            id: newId(),
            authorId: author.id,
            targetType: 'service',
            targetId: serviceId,
            refId: visitId,
            stars,
            comment: rng.pick(REVIEW_TEXTS[stars]!),
            createdAt: new Date(visitedAt.getTime() + rng.int(1, 48) * 3_600_000),
          },
        });
        reviewCount++;
      }
    }
  }

  // The demo user visited one service today and can leave a review right away.
  await prisma.serviceVisit.create({
    data: { id: newId(), userId: demo.id, serviceId: ids[1]!, method: 'geo', distanceM: 35, status: 'verified', createdAt: new Date(now - 2 * 3_600_000) },
  });
  visitCount++;

  for (const id of ids) {
    const [agg] = await prisma.$queryRaw<{ reviews: number; stars: number; visits: number }[]>`
      SELECT (SELECT count(*)::int FROM reviews WHERE target_type = 'service' AND target_id = ${id}::uuid) AS reviews,
             (SELECT coalesce(sum(stars), 0)::int FROM reviews WHERE target_type = 'service' AND target_id = ${id}::uuid) AS stars,
             (SELECT count(*)::int FROM service_visits WHERE service_id = ${id}::uuid AND status = 'verified') AS visits`;
    await prisma.serviceCenter.update({
      where: { id },
      data: { rating: bayesianServiceRating(agg!.stars, agg!.reviews), reviewCount: agg!.reviews, visitCount: agg!.visits },
    });
  }

  return `${ids.length} verified + ${PENDING.length} pending services (${photoCount} photos), ${visitCount} visits, ${reviewCount} reviews`;
}
