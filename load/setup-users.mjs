#!/usr/bin/env node
// Signs up N load-test drivers through the public API with the dev OTP code (SMS_PROVIDER=console +
// AUTH_EXPOSE_DEV_CODE or DEMO_MODE), onboards them, stores a fresh position near Almaty and pairs them
// in direct chats. Writes { users: [{ id, token, chatId, lat, lng }] } to $TOKENS_FILE (default load/.tokens.json).
//
//   API_URL=http://localhost:4500 N=200 node load/setup-users.mjs
//
// Each user gets its own X-Forwarded-For (the API must run with TRUST_PROXY=loopback), so the per-IP OTP
// limit (20/h) is respected rather than disabled. Access tokens live 15 minutes: run the load test right after.
import { writeFileSync } from 'node:fs';

const API = `${process.env.API_URL ?? 'http://localhost:4500'}/api/v1`;
const N = Number(process.env.N ?? 200);
const OUT = process.env.TOKENS_FILE ?? new URL('./.tokens.json', import.meta.url).pathname;
const ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:3500';
const run = Date.now().toString(36).slice(-5);

async function call(method, path, body, { token, ip } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      origin: ORIGIN,
      ...(ip ? { 'x-forwarded-for': ip } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : undefined;
}

async function makeUser(i) {
  const ip = `198.19.${(i >> 8) & 255}.${i & 255}`;
  const phone = `+7709${String(Date.now() % 1000).padStart(3, '0')}${String(i).padStart(4, '0')}`;
  const { devCode } = await call('POST', '/auth/otp/request', { phone }, { ip });
  if (!devCode) throw new Error('No devCode: run the API with SMS_PROVIDER=console and DEMO_MODE/AUTH_EXPOSE_DEV_CODE');
  const { accessToken: token, user } = await call('POST', '/auth/otp/verify', { phone, code: devCode }, { ip });
  await call('PATCH', '/me', { name: `Load ${i}`, nickname: `load_${run}_${i}`, city: 'Almaty' }, { token, ip });
  await call('POST', '/me/onboarding/complete', undefined, { token, ip });
  await call('PATCH', '/me/settings', { privacyMode: 'everyone' }, { token, ip });
  // Spread over central Almaty (~6 × 6 km).
  const lat = 43.22 + ((i * 37) % 100) / 1700;
  const lng = 76.88 + ((i * 53) % 100) / 1300;
  await call('PUT', '/me/location', { lat, lng }, { token, ip });
  return { id: user.id, token, ip, lat, lng };
}

const users = [];
const BATCH = 10;
for (let i = 0; i < N; i += BATCH) {
  users.push(...(await Promise.all(Array.from({ length: Math.min(BATCH, N - i) }, (_, k) => makeUser(i + k)))));
  process.stdout.write(`\r${users.length}/${N} users`);
}
// Pair users in direct chats (0↔1, 2↔3, …) for the message-sending scenario.
for (let i = 0; i + 1 < users.length; i += 2) {
  const chat = await call('POST', '/chats/direct', { userId: users[i + 1].id }, { token: users[i].token, ip: users[i].ip });
  users[i].chatId = chat.id;
  users[i + 1].chatId = chat.id;
}
writeFileSync(OUT, JSON.stringify({ createdAt: new Date().toISOString(), users }, null, 0));
console.log(`\nWrote ${users.length} users to ${OUT}`);
