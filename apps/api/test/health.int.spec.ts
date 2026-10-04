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
