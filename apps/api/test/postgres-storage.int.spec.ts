import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestApp, createUser, type TestApp } from './support/app';
import { jpegWithGps } from './support/images';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ STORAGE_DRIVER: 'postgres', PUBLIC_MEDIA_URL: 'http://localhost:4000/media' });
});
afterAll(async () => {
  await t.close();
});

describe('STORAGE_DRIVER=postgres (demo hosting without a persistent disk)', () => {
  it('stores uploads in the database and serves them at /media with immutable caching', async () => {
    const u = await createUser(t);
    const res = await request(t.http)
      .post('/api/v1/uploads?purpose=avatar')
      .set(bearer(u.token))
      .attach('file', await jpegWithGps(64, 48), { filename: 'a.jpg' })
      .expect(201);

    const path = new URL(res.body.url as string).pathname;
    const media = await request(t.http).get(path).buffer(true).expect(200);
    expect(media.headers['content-type']).toBe('image/webp');
    expect(media.headers['cache-control']).toContain('immutable');
    expect(media.headers['x-content-type-options']).toBe('nosniff');
    expect(Number(media.headers['content-length'])).toBe(res.body.sizeBytes);

    await request(t.http).head(path).expect(200);
    await request(t.http).get('/media/avatar/2026/01/does-not-exist.webp').expect(404);
    await request(t.http).get('/media/..%2F..%2Fetc%2Fpasswd').expect(404);
  });
});
