import type { MyVisit, VisitDto } from '@autoc/shared';
import { describe, expect, it } from 'vitest';
import { initialVisitFlow, isFlowOpen, visitFlowReducer, visitOffer, type VisitFlowAction, type VisitFlowState } from './visit-flow';

const NOW = new Date('2026-10-05T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const visit = (over: Partial<MyVisit>): MyVisit => ({ id: 'v1', method: 'geo', status: 'verified', createdAt: hoursAgo(1), reviewed: false, ...over });

describe('visitOffer', () => {
  it('no visit → can visit', () => {
    expect(visitOffer(null, NOW)).toEqual({ stage: 'none', canVisit: true });
  });
  it('verified, unreviewed → review form, no new visit', () => {
    expect(visitOffer(visit({}), NOW)).toEqual({ stage: 'canReview', canVisit: false });
    expect(visitOffer(visit({ createdAt: hoursAgo(48) }), NOW)).toEqual({ stage: 'canReview', canVisit: false });
  });
  it('pending (photo) → waits; a new visit after 24 h', () => {
    expect(visitOffer(visit({ status: 'pending', method: 'photo' }), NOW)).toEqual({ stage: 'pending', canVisit: false });
    expect(visitOffer(visit({ status: 'pending', createdAt: hoursAgo(25) }), NOW)).toEqual({ stage: 'pending', canVisit: true });
  });
  it('reviewed → thanks; visit again after 24 h', () => {
    expect(visitOffer(visit({ reviewed: true }), NOW)).toEqual({ stage: 'reviewed', canVisit: false });
    expect(visitOffer(visit({ reviewed: true, createdAt: hoursAgo(30) }), NOW)).toEqual({ stage: 'reviewed', canVisit: true });
  });
  it('rejected → try again', () => {
    expect(visitOffer(visit({ status: 'rejected' }), NOW)).toEqual({ stage: 'rejected', canVisit: true });
  });
});

const run = (actions: VisitFlowAction[], from: VisitFlowState = initialVisitFlow) => actions.reduce(visitFlowReducer, from);
const done: VisitDto = { id: 'v', serviceId: 's', method: 'geo', status: 'verified', distanceM: 12, createdAt: NOW.toISOString() };

describe('visitFlowReducer', () => {
  it('open → choose → method → working → done', () => {
    let s = run([{ type: 'open' }]);
    expect(s).toEqual({ step: 'choose' });
    expect(isFlowOpen(s)).toBe(true);
    s = run([{ type: 'choose', method: 'geo' }, { type: 'start' }], s);
    expect(s).toMatchObject({ step: 'geo', phase: 'working' });
    s = run([{ type: 'succeed', visit: done }], s);
    expect(s).toEqual({ step: 'done', visit: done });
    expect(isFlowOpen(s)).toBe(false);
  });

  it('errors keep the step; retrying clears the error', () => {
    const err = new Error('TOO_FAR');
    let s = run([{ type: 'open', method: 'qr' }, { type: 'start' }, { type: 'fail', error: err }]);
    expect(s).toMatchObject({ step: 'qr', phase: 'error', error: err });
    s = run([{ type: 'start' }], s);
    expect(s).toMatchObject({ step: 'qr', phase: 'working', error: null });
  });

  it('cannot go back or close while a request is in flight', () => {
    const working = run([{ type: 'open', method: 'photo' }, { type: 'start' }]);
    expect(run([{ type: 'back' }], working)).toBe(working);
    expect(run([{ type: 'close' }], working)).toBe(working);
    const idle = run([{ type: 'open', method: 'photo' }]);
    expect(run([{ type: 'back' }], idle)).toEqual({ step: 'choose' });
    expect(run([{ type: 'close' }], idle)).toEqual({ step: 'closed' });
  });

  it('deep link opens the QR step with the code', () => {
    expect(run([{ type: 'open', method: 'qr', code: 'ABCD2345' }])).toEqual({ step: 'qr', phase: 'idle', error: null, code: 'ABCD2345' });
  });

  it('ignores actions that do not apply', () => {
    expect(run([{ type: 'start' }])).toEqual(initialVisitFlow);
    expect(run([{ type: 'choose', method: 'geo' }])).toEqual(initialVisitFlow);
    expect(run([{ type: 'succeed', visit: done }])).toEqual(initialVisitFlow);
  });
});
