/**
 * Phase 9 seed: coin wallets (ledger-consistent), a premium demo account, driver votes, detailed vehicles
 * and moderated violations (with evidence photos and their rating penalties). Runs before the ratings are
 * recomputed, so votes and penalties are part of every seeded rating.
 */
import type { PrismaClient, ViolationCategory, WalletTxKind } from '@prisma/client';
import { PREMIUM, RATING_PENALTIES, voteWeight, type VoteReason } from '@autoc/shared';
import sharp from 'sharp';
import type { Storage } from '../../src/infra/storage/storage';

type SeedUser = { id: string; nickname: string; name: string; rating: number; createdAt: Date };
type Ctx = { prisma: PrismaClient; storage: Storage; newId: () => string; now: number; users: SeedUser[] };

const DAY = 86_400_000;

async function seedImage(ctx: Ctx, ownerId: string, purpose: 'vehicle' | 'violation', key: string, color: string, label: string): Promise<string> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="683">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="#1f2937"/></linearGradient></defs>
    <rect width="1024" height="683" fill="url(#g)"/>
    <text x="512" y="360" font-family="sans-serif" font-size="56" fill="#ffffff" text-anchor="middle" opacity="0.85">${label}</text>
  </svg>`;
  const main = await sharp(Buffer.from(svg)).webp({ quality: 80 }).toBuffer();
  const thumb = await sharp(main).resize(400, 267).webp({ quality: 75 }).toBuffer();
  await ctx.storage.put(`${purpose}/seed/${key}.webp`, main, 'image/webp');
  await ctx.storage.put(`${purpose}/seed/${key}_t.webp`, thumb, 'image/webp');
  const id = ctx.newId();
  await ctx.prisma.upload.create({
    data: { id, ownerId, purpose, key: `${purpose}/seed/${key}.webp`, thumbKey: `${purpose}/seed/${key}_t.webp`, mime: 'image/webp', sizeBytes: main.length, width: 1024, height: 683 },
  });
  return id;
}

/**
 * Ledger writer: entries are collected, then ordered by time; balances, `balance_after` and the per-wallet
 * `seq` are computed in that order (as the real ledger does under the wallet lock).
 */
function ledger(ctx: Ctx) {
  type Entry = { id: string; userId: string; kind: WalletTxKind; amount: number; counterpartyId: string | null; ref: string | null; note: string | null; createdAt: Date };
  const entries: Entry[] = [];
  const add = (userId: string, kind: WalletTxKind, amount: number, at: Date, extra: { counterpartyId?: string; ref?: string; note?: string; id?: string } = {}) => {
    const id = extra.id ?? ctx.newId();
    entries.push({ id, userId, kind, amount, counterpartyId: extra.counterpartyId ?? null, ref: extra.ref ?? null, note: extra.note ?? null, createdAt: at });
    return id;
  };
  const finalize = () => {
    const balances = new Map<string, { balance: number; seq: number }>();
    const rows = [...entries]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((e) => {
        const w = balances.get(e.userId) ?? { balance: 0, seq: 0 };
        w.balance += e.amount;
        w.seq += 1;
        if (w.balance < 0) throw new Error(`Seed ledger would overdraw ${e.userId}`);
        balances.set(e.userId, w);
        return { ...e, amount: BigInt(e.amount), balanceAfter: BigInt(w.balance), seq: BigInt(w.seq) };
      });
    return { balances, rows };
  };
  return { add, finalize };
}

export async function seedPhase9(ctx: Ctx): Promise<string> {
  const { prisma, newId, now, users } = ctx;
  const at = (daysAgo: number) => new Date(now - daysAgo * DAY);
  const [, demo] = users;
  const others = users.slice(2);
  const L = ledger(ctx);

  /* ---------------- wallets: demo-provider top-ups, transfers, premium */
  const topup = async (userId: string, amount: number, daysAgo: number) => {
    const id = newId();
    await prisma.topup.create({
      data: { id, userId, amount, provider: 'demo', providerRef: `demo_${id}`, status: 'succeeded', cardLast4: '4242', expiresAt: new Date(at(daysAgo).getTime() + 30 * 60_000), completedAt: at(daysAgo), createdAt: at(daysAgo) },
    });
    L.add(userId, 'topup', amount, at(daysAgo), { ref: id });
  };
  const transfer = (from: SeedUser, to: SeedUser, amount: number, daysAgo: number, note: string) => {
    const outId = newId();
    const inId = newId();
    L.add(from.id, 'transfer_out', -amount, at(daysAgo), { id: outId, counterpartyId: to.id, ref: inId, note });
    L.add(to.id, 'transfer_in', amount, at(daysAgo), { id: inId, counterpartyId: from.id, ref: outId, note });
  };

  // Demo ends at exactly 2 000 coins: 3 000 + 990 + 1 500 (gift) − 2 000 (sent) − 1 490 (premium).
  await topup(demo!.id, 3_000, 40);
  await topup(demo!.id, 990, 12);
  const funded = others.slice(0, 8);
  for (const [i, u] of funded.entries()) await topup(u.id, [3000, 10_000, 1500, 7500, 2000, 50_000, 5000, 1000][i]!, 30 - i * 2);
  transfer(funded[0]!, demo!, 1500, 9, 'Спасибо за прикурку!');
  transfer(demo!, funded[1]!, 2000, 7, 'За бензин до Капчагая');
  transfer(funded[5]!, funded[3]!, 5000, 5, 'Долг за шины');
  transfer(funded[3]!, funded[2]!, 700, 2, 'Кофе на сходке');

  // Premium: the demo account (renews in 20 days) and one of its friends (cancelled, ends in 6 days).
  const premiumFor = async (u: SeedUser, startedDaysAgo: number, autoRenew: boolean) => {
    const id = newId();
    const end = new Date(at(startedDaysAgo).getTime() + PREMIUM.periodDays * DAY);
    await prisma.premiumSubscription.create({ data: { id, userId: u.id, startedAt: at(startedDaysAgo), currentPeriodEnd: end, autoRenew, createdAt: at(startedDaysAgo) } });
    L.add(u.id, 'subscription', -PREMIUM.priceCoins, at(startedDaysAgo), { ref: id });
    await prisma.user.update({ where: { id: u.id }, data: { premiumUntil: end } });
  };
  await premiumFor(demo!, 10, true);
  await premiumFor(funded[1]!, 24, false);

  const { balances, rows } = L.finalize();
  for (const [userId, w] of balances) {
    await prisma.wallet.create({ data: { userId, balance: BigInt(w.balance), lastSeq: BigInt(w.seq), createdAt: at(45) } });
  }
  await prisma.walletTransaction.createMany({ data: rows });

  /* ---------------- detailed vehicles */
  const demoVehicle = await prisma.vehicle.findFirst({ where: { userId: demo!.id, isPrimary: true } });
  if (demoVehicle) {
    const p1 = await seedImage(ctx, demo!.id, 'vehicle', 'demo-1', '#2563eb', `${demoVehicle.brand} ${demoVehicle.model}`);
    const p2 = await seedImage(ctx, demo!.id, 'vehicle', 'demo-2', '#0f766e', 'Салон');
    await prisma.vehicle.update({
      where: { id: demoVehicle.id },
      data: {
        vin: 'JTMHV05J604123456',
        engineVolumeL: 2.5,
        fuel: 'petrol',
        transmission: 'automatic',
        drive: 'awd',
        bodyType: 'crossover',
        color: 'white',
        mileageKm: 68_000,
        description: 'Обслуживается у официального дилера, зимняя резина на дисках.',
        photoUploadIds: [p1, p2],
        coverUploadId: p1,
      },
    });
  }
  const details = [
    { fuel: 'diesel', transmission: 'automatic', drive: 'awd', bodyType: 'suv', color: 'black', engineVolumeL: 4.5, mileageKm: 145_000 },
    { fuel: 'petrol', transmission: 'cvt', drive: 'fwd', bodyType: 'sedan', color: 'silver', engineVolumeL: 1.6, mileageKm: 92_000 },
    { fuel: 'hybrid', transmission: 'cvt', drive: 'fwd', bodyType: 'hatchback', color: 'gray', engineVolumeL: 1.8, mileageKm: 41_000 },
    { fuel: 'electric', transmission: 'automatic', drive: 'rwd', bodyType: 'sedan', color: 'blue', engineVolumeL: null, mileageKm: 23_000 },
    { fuel: 'gas', transmission: 'manual', drive: 'fwd', bodyType: 'wagon', color: 'beige', engineVolumeL: 1.6, mileageKm: 210_000 },
  ] as const;
  const otherVehicles = await prisma.vehicle.findMany({ where: { userId: { in: others.slice(0, 12).map((u) => u.id) }, isPrimary: true }, orderBy: { id: 'asc' } });
  for (const [i, v] of otherVehicles.entries()) await prisma.vehicle.update({ where: { id: v.id }, data: { ...details[i % details.length] } });

  /* ---------------- driver votes */
  const voters = others.filter((u) => u.rating >= 40 && now - u.createdAt.getTime() > 7 * DAY);
  type SeedVote = { voter: SeedUser; target: SeedUser; value: 1 | -1; reason: VoteReason; comment: string | null; daysAgo: number };
  const offender = others[20]!;
  // Phase 10: extra voters (distinct people, one vote each per target) so the traits thresholds are met:
  // demo gets "пропускает" / "аккуратно водит", the offender "подрезает" / "не включает поворотники".
  // The offender's voters are the most trusted ones (their votes weigh more), so the votes alone move the
  // rating clearly down; together with the approved violations it lands in the 0–29 tier.
  const pool = voters.slice(8).filter((u) => u.id !== offender.id);
  if (pool.length < 12) throw new Error(`Seed needs 12 extra voters, has ${pool.length}`);
  const trusted = [...pool].sort((a, b) => b.rating - a.rating || a.id.localeCompare(b.id));
  // extra[0..4] vote for demo, extra[5..11] (the 7 most trusted) for the offender.
  const extra = [...trusted.slice(7, 12), ...trusted.slice(0, 7)];
  const candidates: SeedVote[] = [
    { voter: voters[0]!, target: demo!, value: 1, reason: 'helped_on_road', comment: 'Помог дотащить машину до СТО', daysAgo: 20 },
    { voter: voters[1]!, target: demo!, value: 1, reason: 'polite', comment: null, daysAgo: 14 },
    { voter: voters[2]!, target: demo!, value: 1, reason: 'good_driver', comment: 'Аккуратно водит', daysAgo: 3 },
    { voter: extra[0]!, target: demo!, value: 1, reason: 'lets_merge', comment: 'Пропустил при перестроении на Саина', daysAgo: 26 },
    { voter: extra[1]!, target: demo!, value: 1, reason: 'lets_merge', comment: null, daysAgo: 17 },
    { voter: extra[2]!, target: demo!, value: 1, reason: 'lets_merge', comment: null, daysAgo: 9 },
    { voter: extra[3]!, target: demo!, value: 1, reason: 'careful_driver', comment: null, daysAgo: 12 },
    { voter: extra[4]!, target: demo!, value: 1, reason: 'careful_driver', comment: 'Спокойно и без рывков', daysAgo: 5 },
    { voter: voters[3]!, target: others[3]!, value: 1, reason: 'helped_on_road', comment: 'Вытащил из сугроба', daysAgo: 11 },
    { voter: voters[4]!, target: others[3]!, value: 1, reason: 'polite', comment: null, daysAgo: 6 },
    { voter: voters[5]!, target: offender, value: -1, reason: 'dangerous_driving', comment: 'Подрезал на Аль-Фараби', daysAgo: 4 },
    { voter: voters[6]!, target: offender, value: -1, reason: 'rude', comment: null, daysAgo: 2 },
    { voter: extra[5]!, target: offender, value: -1, reason: 'cuts_off', comment: 'Подрезал на развязке Аль-Фараби — Достык', daysAgo: 22 },
    { voter: extra[6]!, target: offender, value: -1, reason: 'cuts_off', comment: null, daysAgo: 15 },
    { voter: extra[7]!, target: offender, value: -1, reason: 'cuts_off', comment: null, daysAgo: 7 },
    { voter: extra[8]!, target: offender, value: -1, reason: 'cuts_off', comment: 'Влез без поворотника и по тормозам', daysAgo: 1 },
    { voter: extra[9]!, target: offender, value: -1, reason: 'no_turn_signals', comment: null, daysAgo: 19 },
    { voter: extra[10]!, target: offender, value: -1, reason: 'no_turn_signals', comment: null, daysAgo: 10 },
    { voter: extra[11]!, target: offender, value: -1, reason: 'no_turn_signals', comment: null, daysAgo: 3 },
    { voter: voters[7]!, target: others[21]!, value: 1, reason: 'good_driver', comment: null, daysAgo: 30 },
  ];
  const votes = candidates.filter((v) => v.voter && v.target && v.voter.id !== v.target.id);
  for (const v of votes) {
    await prisma.userVote.create({
      data: { id: newId(), voterId: v.voter.id, targetId: v.target.id, value: v.value, reason: v.reason, comment: v.comment, weight: voteWeight(v.voter.rating), createdAt: at(v.daysAgo) },
    });
  }

  /* ---------------- violations: 2 approved (with penalties), 1 pending, 1 disputed, 1 rejected */
  const offenderVehicle = await prisma.vehicle.findFirst({ where: { userId: offender.id, isPrimary: true } });
  const otherOwner = others[22]!;
  const otherVehicle = await prisma.vehicle.findFirst({ where: { userId: otherOwner.id, isPrimary: true } });
  const admin = users[0]!;
  let violations = 0;
  const violation = async (
    vehicle: NonNullable<typeof offenderVehicle>,
    submitter: SeedUser,
    category: ViolationCategory,
    status: 'approved' | 'pending' | 'disputed' | 'rejected',
    daysAgo: number,
    description: string,
    article: string | null,
    dispute: string | null = null,
  ) => {
    const id = newId();
    const photo = await seedImage(ctx, submitter.id, 'violation', `v-${violations}`, '#b91c1c', 'Фото нарушения');
    const decided = status === 'approved' || status === 'rejected';
    await prisma.violation.create({
      data: {
        id,
        vehicleId: vehicle.id,
        ownerId: vehicle.userId,
        submitterId: submitter.id,
        vehicleBrand: vehicle.brand,
        vehicleModel: vehicle.model,
        vehicleYear: vehicle.year,
        category,
        codeType: category === 'drunk_driving' || category === 'accident_fled' ? 'uk' : 'koap',
        article,
        occurredAt: at(daysAgo + 1),
        description,
        photoUploadIds: [photo],
        status,
        disputeText: dispute,
        disputedAt: dispute ? at(daysAgo - 0.5) : null,
        decidedAt: decided ? at(daysAgo - 0.5) : null,
        decidedById: decided ? admin.id : null,
        decisionNote: decided ? (status === 'approved' ? 'Нарушение видно на фото' : 'Номер не читается') : null,
        createdAt: at(daysAgo),
      },
    });
    if (decided) {
      await prisma.adminAction.create({
        data: { id: newId(), adminId: admin.id, action: `violation.${status === 'approved' ? 'approve' : 'reject'}`, targetType: 'violation', targetId: id, targetUserId: vehicle.userId, note: status === 'approved' ? 'Нарушение видно на фото' : 'Номер не читается', createdAt: at(daysAgo - 0.5) },
      });
    }
    if (status === 'approved') {
      await prisma.ratingEvent.create({
        data: { id: newId(), userId: vehicle.userId, delta: 0, reason: 'penalty', refId: id, penaltyPoints: RATING_PENALTIES.violation, penaltyKind: 'violation', createdAt: at(daysAgo - 0.5) },
      });
    }
    violations++;
  };
  if (offenderVehicle && otherVehicle) {
    await violation(offenderVehicle, voters[0]!, 'speeding', 'approved', 25, 'Около 130 км/ч на пр. Аль-Фараби в районе Есентай Молла.', 'ст. 592 КоАП');
    await violation(offenderVehicle, voters[1]!, 'red_light', 'approved', 8, 'Проехал на красный на перекрёстке Абая — Достык.', null);
    // Phase 10: two more approved ones, so the offender sits in the 0–29 tier ("Злостный нарушитель").
    await violation(offenderVehicle, voters[3]!, 'dangerous_driving', 'approved', 40, 'Перестраивался через три полосы без поворотника на ВОАД.', null);
    await violation(offenderVehicle, voters[4]!, 'speeding', 'approved', 60, 'Около 110 км/ч в жилой зоне на ул. Розыбакиева.', 'ст. 592 КоАП');
    await violation(offenderVehicle, voters[2]!, 'wrong_lane', 'pending', 1, 'Выехал на встречную при обгоне на Капчагайской трассе.', null);
    await violation(otherVehicle, voters[3]!, 'parking', 'disputed', 5, 'Припаркован на тротуаре у ТРЦ Mega.', null, 'Это была погрузка, я стоял две минуты.');
    await violation(otherVehicle, voters[4]!, 'dangerous_driving', 'rejected', 15, 'Резко перестраивался без поворотника.', null);
  }

  return `${balances.size} wallets (${rows.length} ledger rows, demo ${balances.get(demo!.id)?.balance} coins, premium for demo), ${votes.length} votes, ${violations} violations (offender with negative traits: @${offender.nickname})`;
}
