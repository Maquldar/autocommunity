/**
 * Phase 3 seed data: Almaty communities with chat histories and the demo user's direct chats.
 * Deterministic: speakers and members come from the seed RNG, texts are fixed.
 */
import type { PrismaClient } from '@prisma/client';
import type { Rng } from './rng';

export type SeedCommunityUser = { id: string; createdAt: Date };

type Line = [speaker: number, text: string];

type CommunitySpec = {
  name: string;
  description: string;
  isPrivate: boolean;
  members: number;
  /** Lines of the chat, oldest first; speaker = index into the member list (0 = owner). */
  chat: Line[];
};

export const COMMUNITIES: CommunitySpec[] = [
  {
    name: 'Land Cruiser Club Almaty',
    description: 'Владельцы Land Cruiser и Prado: выезды в горы, обслуживание, запчасти. Помогаем своим на трассе.',
    isPrivate: false,
    members: 12,
    chat: [
      [0, 'Всем привет! В субботу выезд на Большое Алматинское озеро, сбор в 8:00 у Меги на Розыбакиева.'],
      [1, 'Я в деле, беру компрессор и трос.'],
      [2, 'Дорога после дождей как? Кто был на неделе?'],
      [3, 'Был в среду — до ГЭС-2 нормально, выше местами размыто, но на 200-ке проходится спокойно.'],
      [4, 'Подскажите сервис по подвеске, стук справа спереди появился.'],
      [0, 'На Рыскулова хорошие ребята, скину контакт в личку.'],
      [5, 'Плюсую, делали мне сайлентблоки, недорого.'],
      [2, 'Тогда тоже еду, возьму рацию на 145.500.'],
    ],
  },
  {
    name: 'Toyota Club KZ',
    description: 'Всё о Toyota: Camry, RAV4, Corolla, Highlander. ТО, лайфхаки, встречи по выходным.',
    isPrivate: false,
    members: 16,
    chat: [
      [0, 'Напоминаю: встреча клуба в воскресенье в 11:00 на парковке у Достык Плазы.'],
      [3, 'Кто менял масло в вариаторе на RAV4? Сколько по деньгам вышло?'],
      [5, 'Делал на 60 тысячах, около 45 000 с работой у официалов.'],
      [6, 'У неофициалов в два раза дешевле, главное оригинальная жидкость WS.'],
      [2, 'Ребята, на Аль-Фараби пробка от Есентая до Фурманова, объезжайте через Тимирязева.'],
      [1, 'Спасибо! Как раз туда ехал.'],
      [4, 'Камри 70 — кто ставил сетку в бампер от камней? Стоит того?'],
      [0, 'Стоит, особенно если часто ездишь на Капчагай. Радиатор целее будет.'],
      [7, 'Всем хорошего вечера, на Сайране ДТП, правый ряд закрыт.'],
    ],
  },
  {
    name: 'Offroad 4x4 Алматы',
    description: 'Бездорожье, экспедиции, лебёдки и споры о блокировках. Новичкам помогаем с первыми выездами.',
    isPrivate: false,
    members: 10,
    chat: [
      [0, 'Планируем выезд на Чарынский каньон через две недели, нужна предварительная запись.'],
      [2, 'Записывайте! Нива на 31-й резине, лебёдка есть.'],
      [3, 'А для паркетника там реально проехать или лучше не рисковать?'],
      [1, 'До смотровой реально, дальше в Долину замков — только с клиренсом от 22 см.'],
      [4, 'Кто знает, где в городе купить нормальные стропы и шакл?'],
      [0, 'На Барахолке в рядах 4x4, спрашивайте Ерлана, у него честные цены.'],
      [3, 'Понял, спасибо. Тогда еду до смотровой и жду вас там 🙂'],
    ],
  },
  {
    name: 'EV Almaty',
    description: 'Электромобили в Алматы: зарядки, запас хода зимой, сервис и импорт.',
    isPrivate: false,
    members: 7,
    chat: [
      [0, 'Открыли новую быструю зарядку на Аль-Фараби, 120 кВт, проверял вчера — работает.'],
      [1, 'Отлично! А по оплате через приложение или карту?'],
      [0, 'И так и так, Kaspi QR тоже принимает.'],
      [2, 'Зимой в минус 15 запас хода упал примерно на 30%. У кого так же?'],
      [3, 'Да, примерно так. Предпрогрев от розетки сильно помогает.'],
      [1, 'Кто-нибудь возил из Китая через Хоргос? Сколько заняла растаможка?'],
    ],
  },
  {
    name: 'Женщины за рулём Алматы',
    description: 'Поддержка, советы и взаимопомощь для автоледи. Без осуждения и токсичности.',
    isPrivate: false,
    members: 9,
    chat: [
      [0, 'Девочки, всем привет! Делимся проверенными автосервисами, где не обманывают.'],
      [1, 'Мне нравится шиномонтаж на Жандосова, делают быстро и всё объясняют.'],
      [2, 'Подскажите, как правильно прикурить машину? Аккумулятор сел во дворе.'],
      [3, 'Сначала плюс к плюсу, потом минус донора на массу твоей машины. Если что — пиши, приеду помогу.'],
      [2, 'Спасибо огромное, получилось! 🙏'],
      [4, 'Кто ездит на Медеу по выходным? Можно вместе.'],
    ],
  },
  {
    name: 'Night Drive',
    description: 'Закрытый клуб ночных покатушек по городу и трассе. Вступление по заявке.',
    isPrivate: true,
    members: 6,
    chat: [
      [0, 'Сегодня в 23:30 стартуем от Кок-Тобе, маршрут — Аль-Фараби и в сторону Капчагая.'],
      [1, 'Буду. Только без гонок, по правилам 🙂'],
      [0, 'Конечно, мы за спокойные покатушки и красивые виды.'],
      [2, 'Возьму камеру, сделаю ночные фото на смотровой.'],
      [3, 'Опоздаю минут на 15, догоню на трассе.'],
    ],
  },
];

/** Direct chats of the demo user with friends (index into the friend list); speaker 0 = demo. */
export const DEMO_DIRECT_CHATS: { friend: number; lines: Line[]; unreadTail: number }[] = [
  {
    friend: 0,
    lines: [
      [1, 'Привет! Ты завтра едешь на встречу клуба?'],
      [0, 'Привет, да, буду к 11.'],
      [1, 'Отлично, захвати, пожалуйста, мой трос, я забыл его у тебя в багажнике 😅'],
      [0, 'Без проблем, привезу.'],
      [1, 'Спасибо! Тогда до завтра.'],
      [1, 'Кстати, на Аль-Фараби опять ремонт, лучше ехать через Тимирязева.'],
    ],
    unreadTail: 1,
  },
  {
    friend: 1,
    lines: [
      [0, 'Слушай, где ты ставил тонировку? Очень аккуратно сделали.'],
      [1, 'На Розыбакиева, напротив Меги. Скажи, что от меня — сделают скидку.'],
      [0, 'Супер, спасибо!'],
    ],
    unreadTail: 0,
  },
];

type SeedResult = { communities: number; messages: number; directChats: number };

/**
 * Creates communities (memberCount consistent), their chats and histories. The demo user is an active
 * member of `demoActive` (by index in COMMUNITIES) and has a pending request to `demoPending`.
 */
export async function seedCommunities(
  prisma: PrismaClient,
  rng: Rng,
  newId: () => string,
  opts: {
    now: number;
    demo: SeedCommunityUser;
    friends: SeedCommunityUser[];
    pool: SeedCommunityUser[];
    /** Users that must be active members of the demo's first community (map: co-members). */
    coMembers: SeedCommunityUser[];
    demoActive: number[];
    demoPending: number;
  },
): Promise<SeedResult> {
  const MIN = 60_000;
  let messages = 0;
  for (const [index, spec] of COMMUNITIES.entries()) {
    const shuffled = [...opts.pool].sort(() => rng.next() - 0.5);
    const members: SeedCommunityUser[] = [];
    for (const u of index === opts.demoActive[0] ? [...opts.coMembers, ...shuffled] : shuffled) {
      if (members.length >= spec.members) break;
      if (!members.some((m) => m.id === u.id)) members.push(u);
    }
    const owner = members[0]!;
    const demoActive = opts.demoActive.includes(index);
    const createdAt = new Date(opts.now - rng.int(60, 300) * 24 * 60 * MIN);
    const communityId = newId();
    const chatId = newId();
    const active = demoActive ? [...members, opts.demo] : members;
    await prisma.community.create({
      data: {
        id: communityId,
        name: spec.name,
        description: spec.description,
        city: 'Almaty',
        isPrivate: spec.isPrivate,
        ownerId: owner.id,
        memberCount: active.length,
        createdAt,
      },
    });
    await prisma.communityMember.createMany({
      data: [
        ...active.map((m, i) => ({
          communityId,
          userId: m.id,
          role: i === 0 ? ('owner' as const) : i === 1 ? ('moderator' as const) : ('member' as const),
          status: 'active' as const,
          createdAt: new Date(createdAt.getTime() + i * 3600_000),
          joinedAt: new Date(createdAt.getTime() + i * 3600_000),
        })),
        ...(index === opts.demoPending
          ? [{ communityId, userId: opts.demo.id, role: 'member' as const, status: 'pending' as const, createdAt: new Date(opts.now - 2 * 3600_000) }]
          : []),
      ],
    });

    // History: one line every ~7–40 minutes, ending a few minutes ago.
    const times: number[] = [];
    let at = opts.now - rng.int(3, 30) * MIN;
    for (let i = spec.chat.length - 1; i >= 0; i--) {
      times.unshift(at);
      at -= rng.int(7, 40) * MIN;
    }
    await prisma.chat.create({
      data: { id: chatId, type: 'community', refId: communityId, createdAt, lastMessageAt: new Date(times[times.length - 1]!) },
    });
    // Everyone has read everything except the demo user, who has the last 2 lines unread.
    await prisma.chatMember.createMany({
      data: active.map((m) => ({
        chatId,
        userId: m.id,
        joinedAt: createdAt,
        lastReadAt: new Date(m.id === opts.demo.id ? times[Math.max(0, times.length - 3)]! : opts.now),
      })),
    });
    await prisma.message.createMany({
      data: spec.chat.map(([speaker, text], i) => ({
        id: newId(),
        chatId,
        senderId: members[speaker % members.length]!.id,
        type: 'text' as const,
        text,
        createdAt: new Date(times[i]!),
      })),
    });
    messages += spec.chat.length;
  }

  for (const dm of DEMO_DIRECT_CHATS) {
    const friend = opts.friends[dm.friend]!;
    const chatId = newId();
    const times: number[] = [];
    let at = opts.now - rng.int(10, 90) * MIN;
    for (let i = dm.lines.length - 1; i >= 0; i--) {
      times.unshift(at);
      at -= rng.int(2, 15) * MIN;
    }
    const pairKey = opts.demo.id < friend.id ? `${opts.demo.id}:${friend.id}` : `${friend.id}:${opts.demo.id}`;
    await prisma.chat.create({
      data: { id: chatId, type: 'direct', refId: pairKey, createdAt: new Date(times[0]! - MIN), lastMessageAt: new Date(times[times.length - 1]!) },
    });
    const demoReadUntil = times[times.length - 1 - dm.unreadTail]!;
    await prisma.chatMember.createMany({
      data: [
        { chatId, userId: opts.demo.id, lastReadAt: new Date(demoReadUntil) },
        { chatId, userId: friend.id, lastReadAt: new Date(opts.now) },
      ],
    });
    await prisma.message.createMany({
      data: dm.lines.map(([speaker, text], i) => ({
        id: newId(),
        chatId,
        senderId: speaker === 0 ? opts.demo.id : friend.id,
        type: 'text' as const,
        text,
        createdAt: new Date(times[i]!),
      })),
    });
    messages += dm.lines.length;
  }
  return { communities: COMMUNITIES.length, messages, directChats: DEMO_DIRECT_CHATS.length };
}
