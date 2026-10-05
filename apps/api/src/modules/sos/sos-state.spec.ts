import { SOS_RESPONSE_STATUSES, SOS_STATUSES, type SosResponseStatus, type SosStatus } from '@autoc/shared';
import { describe, expect, it } from 'vitest';
import { sosTransition, type SosAction } from './sos-state';

const ACTIONS: SosAction[] = ['respond', 'withdraw', 'accept', 'decline', 'arrived', 'close', 'cancel', 'expire'];
const RESPONSES: (SosResponseStatus | null)[] = [null, ...SOS_RESPONSE_STATUSES];
const OPEN: SosStatus[] = ['created', 'accepted', 'in_progress'];

/** Independent statement of the rules, written as allowed (sos, response) pairs per action. */
function expected(sos: SosStatus, response: SosResponseStatus | null, active: number, action: SosAction) {
  const open = OPEN.includes(sos);
  switch (action) {
    case 'respond':
      return ['created', 'accepted'].includes(sos) && (response === null || response === 'withdrawn') ? { sos, response: 'offered' } : null;
    case 'withdraw':
      if (!open || !(response === 'offered' || response === 'accepted')) return null;
      return { sos: sos === 'accepted' && (response === 'accepted' ? active - 1 : active) <= 0 ? 'created' : sos, response: 'withdrawn' };
    case 'accept':
      if (!open || response !== 'offered') return null;
      if (active >= 3) return 'limit';
      return { sos: sos === 'created' ? 'accepted' : sos, response: 'accepted' };
    case 'decline':
      return open && response === 'offered' ? { sos, response: 'declined' } : null;
    case 'arrived':
      return (sos === 'accepted' || sos === 'in_progress') && response === 'accepted' ? { sos: 'in_progress', response: 'arrived' } : null;
    case 'close':
      return sos === 'accepted' || sos === 'in_progress' ? { sos: 'closed', response } : null;
    case 'cancel':
      return open ? { sos: 'cancelled', response } : null;
    case 'expire':
      return sos === 'created' ? { sos: 'expired', response } : null;
  }
}

describe('sosTransition (exhaustive)', () => {
  it('matches the rules for every status × response × action × helper count', () => {
    let checked = 0;
    for (const sos of SOS_STATUSES) {
      for (const response of RESPONSES) {
        for (const action of ACTIONS) {
          for (let active = 0; active <= 4; active++) {
            const got = sosTransition({ sos, response, activeHelpers: active }, action);
            const want = expected(sos, response, active, action);
            const label = `${action} on ${sos}/${response}/${active}`;
            if (want === null) expect(got, label).toEqual({ ok: false, code: 'SOS_INVALID_STATE' });
            else if (want === 'limit') expect(got, label).toEqual({ ok: false, code: 'SOS_HELPER_LIMIT' });
            else expect(got, label).toEqual({ ok: true, ...want });
            checked++;
          }
        }
      }
    }
    expect(checked).toBe(6 * 6 * 8 * 5);
  });

  it('spot checks the key paths', () => {
    expect(sosTransition({ sos: 'created', response: 'offered', activeHelpers: 0 }, 'accept')).toEqual({ ok: true, sos: 'accepted', response: 'accepted' });
    expect(sosTransition({ sos: 'accepted', response: 'accepted', activeHelpers: 1 }, 'withdraw')).toEqual({ ok: true, sos: 'created', response: 'withdrawn' });
    expect(sosTransition({ sos: 'accepted', response: 'accepted', activeHelpers: 2 }, 'withdraw')).toEqual({ ok: true, sos: 'accepted', response: 'withdrawn' });
    expect(sosTransition({ sos: 'in_progress', response: 'accepted', activeHelpers: 2 }, 'withdraw')).toEqual({ ok: true, sos: 'in_progress', response: 'withdrawn' });
    expect(sosTransition({ sos: 'accepted', response: 'offered', activeHelpers: 3 }, 'accept')).toEqual({ ok: false, code: 'SOS_HELPER_LIMIT' });
    expect(sosTransition({ sos: 'accepted', response: 'arrived', activeHelpers: 1 }, 'withdraw')).toEqual({ ok: false, code: 'SOS_INVALID_STATE' });
    expect(sosTransition({ sos: 'created', response: 'declined', activeHelpers: 0 }, 'respond')).toEqual({ ok: false, code: 'SOS_INVALID_STATE' });
    expect(sosTransition({ sos: 'in_progress', response: null, activeHelpers: 1 }, 'respond')).toEqual({ ok: false, code: 'SOS_INVALID_STATE' });
    expect(sosTransition({ sos: 'accepted', response: null, activeHelpers: 1 }, 'expire')).toEqual({ ok: false, code: 'SOS_INVALID_STATE' });
  });
});
