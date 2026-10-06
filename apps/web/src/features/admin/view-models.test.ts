import type { AdminReportDto, AdminStatsDto } from '@autoc/shared';
import { describe, expect, it } from 'vitest';
import {
  canRemoveContent,
  flagFacts,
  flagSosId,
  flatten,
  formatDuration,
  formatPercent,
  noteError,
  pickParam,
  reportTargetHref,
  statTiles,
  untilFromPreset,
  userActions,
} from './view-models';

const stats: AdminStatsDto = {
  users: { total: 1234, active7d: 400, new7d: 25, blocked: 3 },
  sos: { open: 2, last7d: 10, closed7d: 7, medianFirstResponseSec7d: 200, fakeRate30d: 0.0625 },
  reports: { open: 0 },
  services: { pending: 2 },
  visits: { pending: 0 },
  communities: { total: 6 },
};

describe('statTiles', () => {
  it('covers every MVP metric with formatted values, links and attention flags', () => {
    const tiles = statTiles(stats, { locale: 'en' });
    expect(tiles.map((t) => t.key)).toEqual([
      'usersTotal',
      'usersActive7d',
      'usersNew7d',
      'usersBlocked',
      'sosOpen',
      'sos7d',
      'sosClosed7d',
      'firstResponse',
      'fakeRate',
      'reportsOpen',
      'servicesPending',
      'visitsPending',
      'communities',
    ]);
    const by = Object.fromEntries(tiles.map((t) => [t.key, t]));
    expect(by.usersTotal).toMatchObject({ value: '1,234', href: '/admin/users', attention: false });
    expect(by.firstResponse!.value).toBe('3 min 20 s');
    expect(by.fakeRate).toMatchObject({ value: '6.3%', attention: true });
    expect(by.reportsOpen!.attention).toBe(false);
    expect(by.servicesPending!.attention).toBe(true);
    expect(by.sosOpen!.href).toBe('/admin/sos?status=created');
  });

  it('shows a dash when there is no first-response data', () => {
    const tiles = statTiles({ ...stats, sos: { ...stats.sos, medianFirstResponseSec7d: null } });
    expect(tiles.find((t) => t.key === 'firstResponse')).toMatchObject({ value: '—', raw: null });
  });
});

describe('formatting', () => {
  it('formats durations and percentages', () => {
    expect(formatDuration(45)).toBe('45 s');
    expect(formatDuration(3_900)).toBe('1 h 05 min');
    expect(formatDuration(-1)).toBe('—');
    expect(formatDuration(61, { h: 'ч', m: 'мин', s: 'с' })).toBe('1 мин 1 с');
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(Number.NaN)).toBe('0%');
  });
});

describe('userActions', () => {
  const base = { id: 'u', role: 'user' as const, status: 'active' as const, sosBannedUntil: null };
  const now = Date.parse('2026-10-05T12:00:00Z');

  it('offers warn/block/sos-ban for an active user', () => {
    expect(userActions(base, 'admin', now)).toEqual({ protectedTarget: false, warn: true, block: true, unblock: false, sosBan: true, sosUnban: false });
  });

  it('offers unblock for a blocked user and sos-unban during a ban', () => {
    const a = userActions({ ...base, status: 'blocked', sosBannedUntil: '2026-10-06T00:00:00Z' }, 'admin', now);
    expect(a).toMatchObject({ block: false, unblock: true, sosBan: false, sosUnban: true });
    expect(userActions({ ...base, sosBannedUntil: '2026-10-01T00:00:00Z' }, 'admin', now)).toMatchObject({ sosBan: true, sosUnban: false });
  });

  it('protects self and other admins', () => {
    expect(userActions(base, 'u', now)).toMatchObject({ protectedTarget: true, warn: false, block: false });
    expect(userActions({ ...base, role: 'admin' }, 'other', now)).toMatchObject({ protectedTarget: true, sosBan: false });
  });

  it('offers nothing for deleted accounts', () => {
    expect(userActions({ ...base, status: 'deleted' }, 'admin', now)).toMatchObject({ warn: false, block: false, unblock: false, sosBan: false });
  });
});

describe('presets and notes', () => {
  it('turns presets into ISO dates (forever → null)', () => {
    const now = Date.parse('2026-10-05T00:00:00Z');
    expect(untilFromPreset('24h', now)).toBe('2026-10-06T00:00:00.000Z');
    expect(untilFromPreset('72h', now)).toBe('2026-10-08T00:00:00.000Z');
    expect(untilFromPreset('30d', now)).toBe('2026-11-04T00:00:00.000Z');
    expect(untilFromPreset('forever', now)).toBeNull();
  });

  it('validates notes like the API (3–500 after trimming)', () => {
    expect(noteError('  ab ')).toBe('tooShort');
    expect(noteError('abc')).toBeNull();
    expect(noteError('x'.repeat(501))).toBe('tooLong');
  });
});

describe('reports', () => {
  const report = (over: Partial<AdminReportDto>): AdminReportDto => ({
    id: 'r',
    targetType: 'message',
    targetId: 't',
    reason: 'spam',
    details: null,
    status: 'open',
    resolutionNote: null,
    createdAt: '2026-10-05T00:00:00Z',
    resolvedAt: null,
    reporter: { id: 'a', nickname: 'a', name: 'A', avatarUrl: null, rating: 50 },
    targetUser: { id: 'b', nickname: 'b', name: 'B', avatarUrl: null, rating: 50 },
    preview: { title: null, text: 'x', imageUrl: null, deleted: false },
    ...over,
  });

  it('allows content removal only for removable, still-present content of open reports', () => {
    expect(canRemoveContent(report({}))).toBe(true);
    expect(canRemoveContent(report({ targetType: 'community' }))).toBe(true);
    expect(canRemoveContent(report({ targetType: 'service' }))).toBe(true);
    expect(canRemoveContent(report({ targetType: 'user' }))).toBe(false);
    expect(canRemoveContent(report({ targetType: 'sos', reason: 'spam' }))).toBe(false);
    expect(canRemoveContent(report({ targetType: 'sos', reason: 'fake_sos' }))).toBe(true);
    expect(canRemoveContent(report({ preview: { title: null, text: null, imageUrl: null, deleted: true } }))).toBe(false);
    expect(canRemoveContent(report({ status: 'confirmed' }))).toBe(false);
  });

  it('links to the target', () => {
    expect(reportTargetHref(report({ targetType: 'user', targetId: 'u1' }))).toBe('/admin/users/u1');
    expect(reportTargetHref(report({ targetType: 'sos', targetId: 's1' }))).toBe('/admin/sos/s1');
    expect(reportTargetHref(report({ targetType: 'service', targetId: 'v1' }))).toBe('/services/v1');
    expect(reportTargetHref(report({ targetType: 'community', targetId: 'c1' }))).toBe('/communities/c1');
    expect(reportTargetHref(report({ targetType: 'community', preview: { title: null, text: null, imageUrl: null, deleted: true } }))).toBeNull();
    expect(reportTargetHref(report({ targetType: 'message' }))).toBe('/admin/users/b');
    expect(reportTargetHref(report({ targetType: 'message', targetUser: null }))).toBeNull();
  });
});

describe('fraud flags', () => {
  it('extracts the facts per kind and ignores malformed values', () => {
    expect(flagFacts({ kind: 'sos_cancel_streak', details: { count: 3, bannedUntil: '2026-10-08T00:00:00Z', sosIds: [] } })).toEqual({
      count: 3,
      until: '2026-10-08T00:00:00Z',
    });
    expect(flagFacts({ kind: 'otp_abuse', details: { phoneMasked: '+7 701 *** ** 11', lockouts: 4 } })).toEqual({ phone: '+7 701 *** ** 11', lockouts: 4 });
    expect(flagFacts({ kind: 'duplicate_sos_photo', details: { matches: [{}, {}] } })).toEqual({ matches: 2 });
    expect(flagFacts({ kind: 'report_burst', details: { reporters: '3' } })).toEqual({});
    expect(flagFacts({ kind: 'unknown', details: { x: 1 } })).toEqual({});
  });

  it('finds the SOS a flag refers to', () => {
    const id = '0192a6c5-1234-7abc-8def-0123456789ab';
    expect(flagSosId({ details: { sosId: id } })).toBe(id);
    expect(flagSosId({ details: { triggerSosId: id } })).toBe(id);
    expect(flagSosId({ details: { sosId: 'javascript:alert(1)' } })).toBeNull();
  });
});

describe('helpers', () => {
  it('flattens pages and picks enum params', () => {
    expect(flatten({ pages: [{ items: [1, 2] }, { items: [3] }] })).toEqual([1, 2, 3]);
    expect(flatten<number>(undefined)).toEqual([]);
    expect(pickParam('open', ['open', 'confirmed'] as const)).toBe('open');
    expect(pickParam('bogus', ['open'] as const)).toBeUndefined();
    expect(pickParam(null, ['open'] as const)).toBeUndefined();
  });
});
