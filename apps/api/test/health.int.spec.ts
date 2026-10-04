import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './support/app';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

describe('GET /health', () => {
  it('reports database and Redis status without auth', async () => {
    const res = await request(t.http).get('/api/v1/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', db: 'ok', redis: 'ok' });
    expect(res.headers['x-request-id']).toEqual(expect.any(String));
  });

  it('sets security headers and CORS for allowed origins only', async () => {
    const ok = await request(t.http).get('/api/v1/health').set('Origin', 'http://localhost:3000').expect(200);
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    expect(ok.headers['x-content-type-options']).toBe('nosniff');
    const evil = await request(t.http).get('/api/v1/health').set('Origin', 'https://evil.example').expect(200);
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('HTTP pipeline hardening', () => {
  const otpRequest = () => request(t.http).post('/api/v1/auth/otp/request').set('X-Forwarded-For', '10.200.0.1');

  it('does not parse urlencoded or text bodies (no cross-site form posts)', async () => {
    const form = await otpRequest().type('form').send('phone=%2B77011112233').expect(400);
    expect(form.body.error.code).toBe('VALIDATION_ERROR');
    expect(form.body.error.details[0].path).toEqual(['phone']);
    await otpRequest().set('Content-Type', 'text/plain').send('{"phone":"+77011112233"}').expect(400);
  });

  it('rejects state-changing requests from origins that are not allow-listed', async () => {
    const res = await otpRequest().set('Origin', 'https://evil.example').send({ phone: '+77011112233' }).expect(403);
    expect(res.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
    await otpRequest().set('Origin', 'null').send({ phone: '+77011112233' }).expect(403);
    await otpRequest().set('Origin', 'http://localhost:3000').send({ phone: '+77011112244' }).expect(200);
    // Safe methods and requests without Origin (non-browser clients) are not affected.
    await request(t.http).get('/api/v1/health').set('Origin', 'https://evil.example').expect(200);
  });

  it('renders malformed and oversized JSON in the error shape without parser details', async () => {
    const bad = await otpRequest().set('Content-Type', 'application/json').send('{"phone":').expect(400);
    expect(bad.body).toEqual({ error: { code: 'INVALID_JSON', message: 'Malformed JSON body' } });
    const big = await otpRequest().send({ phone: 'x'.repeat(200 * 1024) }).expect(413);
    expect(big.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});
