import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestApp, createUser, type TestApp } from './support/app';
import { jpegWithGps, oggOpus, webmAudio } from './support/images';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

const upload = (token: string, purpose: string, file: Buffer, filename: string, fields: Record<string, string> = {}) => {
  let r = request(t.http).post('/api/v1/uploads').set(bearer(token)).field('purpose', purpose);
  for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
  return r.attach('file', file, { filename });
};

/** Fetches a stored object through the /media route served by the API. */
const fetchMedia = async (url: string) => {
  const path = new URL(url).pathname;
  const res = await request(t.http).get(path).buffer(true).parse((r, cb) => {
    const chunks: Buffer[] = [];
    r.on('data', (c: Buffer) => chunks.push(c));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  });
  return res;
};

describe('POST /uploads', () => {
  it('re-encodes a JPEG to WebP, applies EXIF orientation and strips all metadata (GPS)', async () => {
    const u = await createUser(t);
    const input = await jpegWithGps(64, 48);
    const inMeta = await sharp(input).metadata();
    expect(inMeta.exif?.toString('latin1')).toContain('GPS-1');

    const res = await upload(u.token, 'sos', input, 'photo.jpg').expect(201);
    expect(res.body).toMatchObject({ mime: 'image/webp', width: 48, height: 64, durationSec: null });
    expect(res.body.url).toMatch(/^http:\/\/localhost:4000\/media\/sos\/\d{4}\/\d{2}\/[0-9a-f]{32}\.webp$/);
    expect(res.body.url).not.toContain('photo');
    expect(res.body.thumbUrl).toMatch(/_t\.webp$/);

    const stored = await fetchMedia(res.body.url);
    expect(stored.status).toBe(200);
    expect(stored.headers['cache-control']).toContain('immutable');
    const outMeta = await sharp(stored.body as Buffer).metadata();
    expect(outMeta.format).toBe('webp');
    expect(outMeta.exif).toBeUndefined();
    expect(outMeta.xmp).toBeUndefined();
    expect(outMeta.icc).toBeUndefined();
    expect((stored.body as Buffer).includes(Buffer.from('GPS'))).toBe(false);

    const row = await t.prisma.upload.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.ownerId).toBe(u.id);
  });

  it('downscales large images to 2048 px with a 400 px thumbnail', async () => {
    const u = await createUser(t);
    const big = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: '#0a0' } }).jpeg().toBuffer();
    const res = await upload(u.token, 'post', big, 'big.jpg').expect(201);
    expect(res.body).toMatchObject({ width: 2048, height: 1024 });
    const thumb = await fetchMedia(res.body.thumbUrl);
    const meta = await sharp(thumb.body as Buffer).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBe(400);
  });

  it('rejects a text file renamed to .jpg (magic bytes)', async () => {
    const u = await createUser(t);
    const res = await upload(u.token, 'avatar', Buffer.from('this is definitely not an image\n'.repeat(10)), 'evil.jpg').expect(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
  });

  it('rejects an image sent for the voice purpose and validates purpose', async () => {
    const u = await createUser(t);
    const jpeg = await jpegWithGps();
    await upload(u.token, 'voice', jpeg, 'a.webm').expect(415);
    const bad = await upload(u.token, 'selfie', jpeg, 'a.jpg').expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    const missing = await request(t.http).post('/api/v1/uploads').set(bearer(u.token)).field('purpose', 'avatar').expect(400);
    expect(missing.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('stores voice notes as-is and clamps the client duration to 3 minutes', async () => {
    const u = await createUser(t);
    const res = await upload(u.token, 'voice', oggOpus(), 'note.ogg', { durationSec: '999' }).expect(201);
    expect(res.body).toMatchObject({ mime: 'audio/ogg', durationSec: 180, thumbUrl: null, width: null });
  });

  it('serves WebM voice notes as audio/webm', async () => {
    const u = await createUser(t);
    const res = await upload(u.token, 'voice', webmAudio(), 'note.webm', { durationSec: '4.2' }).expect(201);
    expect(res.body).toMatchObject({ mime: 'audio/webm', durationSec: 4.2 });
    expect(res.body.url).toMatch(/\.weba$/);
    const stored = await fetchMedia(res.body.url);
    expect(stored.headers['content-type']).toBe('audio/webm');
  });

  it('accepts purpose in the query string, which takes precedence over the form field', async () => {
    const u = await createUser(t);
    const jpeg = await jpegWithGps();
    const ok = await request(t.http)
      .post('/api/v1/uploads?purpose=avatar')
      .set(bearer(u.token))
      .attach('file', jpeg, { filename: 'a.jpg' })
      .expect(201);
    expect((await t.prisma.upload.findUniqueOrThrow({ where: { id: ok.body.id } })).purpose).toBe('avatar');
    await request(t.http)
      .post('/api/v1/uploads?purpose=voice')
      .set(bearer(u.token))
      .field('purpose', 'avatar')
      .attach('file', jpeg, { filename: 'a.jpg' })
      .expect(415);
    await request(t.http).post('/api/v1/uploads?purpose=selfie').set(bearer(u.token)).attach('file', jpeg, { filename: 'a.jpg' }).expect(400);
  });

  it('caps the stream at the per-kind limit when purpose is in the query', async () => {
    const u = await createUser(t);
    // 11 MB is under the 50 MB global cap but over the 10 MB image cap: rejected while streaming.
    const res = await request(t.http)
      .post('/api/v1/uploads?purpose=avatar')
      .set(bearer(u.token))
      .attach('file', Buffer.alloc(11 * 1024 * 1024, 7), { filename: 'big.jpg' })
      .expect(413);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
  });

  it('enforces per-kind size limits', async () => {
    const u = await createUser(t);
    const res = await upload(u.token, 'voice', oggOpus(5 * 1024 * 1024), 'long.ogg').expect(413);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
  });

  it('requires authentication', async () => {
    await request(t.http).post('/api/v1/uploads').field('purpose', 'avatar').expect(401);
  });

  it('limits uploads to 60 per hour per user', async () => {
    const u = await createUser(t);
    await t.redis.eval(
      "for i=1,60 do redis.call('ZADD', KEYS[1], ARGV[1], 'seed'..i) end redis.call('PEXPIRE', KEYS[1], 3600000)",
      1,
      `rl:upload:user:${u.id}`,
      Date.now(),
    );
    const res = await upload(u.token, 'avatar', await jpegWithGps(), 'a.jpg').expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    // Charged before the body is read: a too-large file is still answered with 429, not 413.
    const big = await request(t.http)
      .post('/api/v1/uploads?purpose=avatar')
      .set(bearer(u.token))
      .attach('file', Buffer.alloc(1024 * 1024, 1), { filename: 'x.jpg' })
      .catch((err: { response?: { status: number } }) => err.response);
    expect(big?.status).toBe(429);
  });

  it('does not list directories or serve dotfiles under /media', async () => {
    await request(t.http).get('/media/').expect(404);
    await request(t.http).get('/media/sos/').expect(404);
    await request(t.http).get('/media/../package.json').expect(404);
  });
});
