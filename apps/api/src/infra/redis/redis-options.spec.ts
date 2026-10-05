import { describe, expect, it } from 'vitest';
import { redisOptionsFromUrl } from './redis-options';

describe('redisOptionsFromUrl', () => {
  it('parses host, port, credentials, db and TLS', () => {
    expect(redisOptionsFromUrl('redis://localhost:6379/15')).toEqual({ host: 'localhost', port: 6379, db: 15 });
    expect(redisOptionsFromUrl('rediss://red-user:p%40ss@host.example:6380', { maxRetriesPerRequest: null })).toEqual({
      host: 'host.example',
      port: 6380,
      username: 'red-user',
      password: 'p@ss',
      tls: {},
      maxRetriesPerRequest: null,
    });
    expect(redisOptionsFromUrl('redis://:secret@h')).toEqual({ host: 'h', port: 6379, password: 'secret' });
  });
});
