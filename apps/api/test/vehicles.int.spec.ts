import { LIMITS } from '@autoc/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestApp, createUser, type TestApp } from './support/app';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

const add = (token: string, body: Record<string, unknown>) =>
  request(t.http).post('/api/v1/me/vehicles').set(bearer(token)).send({ brand: 'Toyota', model: 'Camry', year: 2018, ...body });
const list = async (token: string) => (await request(t.http).get('/api/v1/me/vehicles').set(bearer(token)).expect(200)).body as {
  id: string;
  isPrimary: boolean;
  model: string;
}[];
const primaries = async (token: string) => (await list(token)).filter((v) => v.isPrimary).map((v) => v.model);

describe('vehicles', () => {
  it('first vehicle is primary automatically; isPrimary on a new one moves the flag', async () => {
    const u = await createUser(t);
    const first = await add(u.token, { model: 'A', plate: ' 777 aaa 02 ' }).expect(201);
    expect(first.body).toMatchObject({ isPrimary: true, plate: '777 AAA 02' });
    const second = await add(u.token, { model: 'B' }).expect(201);
    expect(second.body.isPrimary).toBe(false);
    await add(u.token, { model: 'C', isPrimary: true }).expect(201);
    expect(await primaries(u.token)).toEqual(['C']);
    expect((await list(u.token))[0]!.model).toBe('C');
  });

  it('PATCH can move or hand over the primary flag and edit fields', async () => {
    const u = await createUser(t);
    const a = (await add(u.token, { model: 'A' }).expect(201)).body;
    const b = (await add(u.token, { model: 'B' }).expect(201)).body;
    await request(t.http).patch(`/api/v1/me/vehicles/${b.id}`).set(bearer(u.token)).send({ isPrimary: true }).expect(200);
    expect(await primaries(u.token)).toEqual(['B']);
    await request(t.http).patch(`/api/v1/me/vehicles/${b.id}`).set(bearer(u.token)).send({ isPrimary: false }).expect(200);
    expect(await primaries(u.token)).toEqual(['A']);
    const edited = await request(t.http)
      .patch(`/api/v1/me/vehicles/${a.id}`)
      .set(bearer(u.token))
      .send({ year: 2020, plate: '' })
      .expect(200);
    expect(edited.body).toMatchObject({ year: 2020, plate: null, isPrimary: true });
  });

  it('a lone vehicle stays primary', async () => {
    const u = await createUser(t);
    const a = (await add(u.token, { model: 'A' }).expect(201)).body;
    const res = await request(t.http).patch(`/api/v1/me/vehicles/${a.id}`).set(bearer(u.token)).send({ isPrimary: false }).expect(200);
    expect(res.body.isPrimary).toBe(true);
  });

  it('deleting the primary promotes the oldest remaining vehicle', async () => {
    const u = await createUser(t);
    const a = (await add(u.token, { model: 'A' }).expect(201)).body;
    await add(u.token, { model: 'B' }).expect(201);
    await add(u.token, { model: 'C' }).expect(201);
    await request(t.http).delete(`/api/v1/me/vehicles/${a.id}`).set(bearer(u.token)).expect(204);
    expect(await primaries(u.token)).toEqual(['B']);
  });

  it(`allows at most ${LIMITS.vehiclesPerUser} vehicles`, async () => {
    const u = await createUser(t);
    await Promise.all(Array.from({ length: LIMITS.vehiclesPerUser + 2 }, (_, i) => add(u.token, { model: `M${i}` })));
    expect(await list(u.token)).toHaveLength(LIMITS.vehiclesPerUser);
    expect(await primaries(u.token)).toHaveLength(1);
    const res = await add(u.token, { model: 'extra' }).expect(409);
    expect(res.body.error.code).toBe('VEHICLE_LIMIT');
  });

  it('validates input and ownership', async () => {
    const u = await createUser(t);
    const other = await createUser(t);
    const bad = await add(u.token, { year: 1900, plate: 'кириллица' }).expect(400);
    const paths = bad.body.error.details.map((i: { path: string[] }) => i.path[0]);
    expect(paths).toEqual(expect.arrayContaining(['year', 'plate']));
    await add(u.token, { year: new Date().getUTCFullYear() + 2 }).expect(400);

    const v = (await add(u.token, {}).expect(201)).body;
    await request(t.http).patch(`/api/v1/me/vehicles/${v.id}`).set(bearer(other.token)).send({ year: 2001 }).expect(404);
    await request(t.http).delete(`/api/v1/me/vehicles/${v.id}`).set(bearer(other.token)).expect(404);
  });
});
