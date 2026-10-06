import { describe, expect, it } from 'vitest';
import { ADMIN_SECTIONS } from './admin-nav';
import { checkAdjust, flagFacts, violationActions } from './view-models';

describe('admin phase 9 view-models', () => {
  it('lists violations in the admin navigation', () => {
    expect(ADMIN_SECTIONS.map((s) => s.href)).toContain('/admin/violations');
  });
  it('offers decisions by status', () => {
    expect(violationActions({ status: 'pending' })).toEqual({ approve: true, reject: true, resolve: false });
    expect(violationActions({ status: 'disputed' })).toEqual({ approve: false, reject: false, resolve: true });
    expect(violationActions({ status: 'approved' })).toEqual({ approve: false, reject: false, resolve: false });
  });
  it('checks balance adjustments', () => {
    expect(checkAdjust('', 100)).toEqual({ ok: false, error: 'required' });
    expect(checkAdjust('0', 100)).toEqual({ ok: false, error: 'zero' });
    expect(checkAdjust('+1.5', 100)).toEqual({ ok: false, error: 'notWhole' });
    expect(checkAdjust('-200', 100)).toEqual({ ok: false, error: 'belowZero' });
    expect(checkAdjust('−100', 100)).toEqual({ ok: true, amount: -100 });
    expect(checkAdjust('+1 000', 0)).toEqual({ ok: true, amount: 1000 });
    expect(checkAdjust('2000000', 0)).toEqual({ ok: false, error: 'tooLarge' });
  });
  it('shows facts for the new fraud flags', () => {
    expect(flagFacts({ kind: 'wallet_funnel', details: { senderIds: ['a', 'b', 'c'], total: 1500 } })).toEqual({ senders: 3, total: 1500 });
    expect(flagFacts({ kind: 'vote_burst', details: { voterIds: ['a'], count: 5 } })).toEqual({ downvotes: 5 });
    expect(flagFacts({ kind: 'violation_rejections', details: { count: 3, violationIds: [] } })).toEqual({ rejected: 3 });
  });
});
