import { describe, expect, it } from 'vitest';
import { response, sos } from './fixtures';
import { helperView, requesterView, timelineSteps } from './view-model';

describe('timelineSteps', () => {
  it('marks the current step for each open status', () => {
    expect(timelineSteps(sos({ status: 'created' })).map((s) => s.state)).toEqual(['current', 'upcoming', 'upcoming', 'upcoming']);
    expect(timelineSteps(sos({ status: 'accepted' })).map((s) => s.state)).toEqual(['done', 'current', 'upcoming', 'upcoming']);
    expect(timelineSteps(sos({ status: 'in_progress' })).map((s) => s.state)).toEqual(['done', 'done', 'current', 'upcoming']);
    expect(timelineSteps(sos({ status: 'closed' })).map((s) => `${s.key}:${s.state}`)).toEqual([
      'created:done',
      'accepted:done',
      'in_progress:done',
      'closed:current',
    ]);
  });
  it('ends cancelled/expired with only the steps reached', () => {
    expect(timelineSteps(sos({ status: 'expired' })).map((s) => s.key)).toEqual(['created', 'expired']);
    expect(timelineSteps(sos({ status: 'cancelled', responses: [response('a', 'accepted')] })).map((s) => s.key)).toEqual([
      'created',
      'accepted',
      'cancelled',
    ]);
    expect(timelineSteps(sos({ status: 'expired', responses: [response('a', 'arrived')] })).map((s) => s.key)).toEqual([
      'created',
      'accepted',
      'in_progress',
      'expired',
    ]);
  });
});

describe('requesterView', () => {
  it('while searching: cancel and share only; offers can be accepted or declined', () => {
    const v = requesterView(sos({ responses: [response('a', 'offered')] }));
    expect(v).toMatchObject({ open: true, searching: true, canCancel: true, canClose: false, canMarkArrived: false, canShare: true, canOpenChat: false });
    expect(v.responseActions(v.liveResponses[0]!)).toMatchObject({ canAccept: true, canDecline: true, phone: null });
  });

  it('accepted: close, mark arrived, chat, helper phone; sorted accepted first, past offers apart', () => {
    const s = sos({
      status: 'accepted',
      chatId: 'c1',
      responses: [response('a', 'offered'), response('b', 'accepted', { helperPhone: '+77070000000' }), response('c', 'withdrawn')],
    });
    const v = requesterView(s);
    expect(v).toMatchObject({ searching: false, canClose: true, canMarkArrived: true, canOpenChat: true, acceptedCount: 1 });
    expect(v.liveResponses.map((r) => r.id)).toEqual(['b', 'a']);
    expect(v.pastResponses.map((r) => r.id)).toEqual(['c']);
    expect(v.responseActions(v.liveResponses[0]!).phone).toBe('+77070000000');
    expect(v.responseActions(v.liveResponses[0]!).canAccept).toBe(false);
  });

  it('caps accepting at 3 helpers', () => {
    const v = requesterView(
      sos({ status: 'in_progress', responses: [response('a', 'arrived'), response('b', 'accepted'), response('c', 'accepted'), response('d', 'offered')] }),
    );
    expect(v.canAcceptMore).toBe(false);
    const offered = v.liveResponses.find((r) => r.id === 'd')!;
    expect(v.responseActions(offered)).toMatchObject({ canAccept: false, canDecline: true });
  });

  it('in_progress with everyone arrived: no "helper arrived" button', () => {
    expect(requesterView(sos({ status: 'in_progress', responses: [response('a', 'arrived')] })).canMarkArrived).toBe(false);
  });

  it('ended: nothing actionable, phones hidden', () => {
    const v = requesterView(sos({ status: 'closed', chatId: 'c1', responses: [response('a', 'arrived', { helperPhone: '+7707' })] }));
    expect(v).toMatchObject({ open: false, canCancel: false, canClose: false, canShare: false, canOpenChat: true });
    expect(v.responseActions(v.liveResponses[0]!).phone).toBeNull();
  });
});

describe('helperView', () => {
  const viewer = (extra = {}) => sos({ myRole: 'viewer', ...extra });

  it('can offer while created/accepted; direct message; call only with a phone', () => {
    expect(helperView(viewer())).toMatchObject({ state: 'can_offer', canRespond: true, callPhone: null, message: { kind: 'direct', userId: 'req' } });
    expect(helperView(viewer({ status: 'accepted', contactPhone: '+7707' }))).toMatchObject({ state: 'can_offer', callPhone: '+7707' });
  });

  it('in_progress without a response: unavailable', () => {
    expect(helperView(viewer({ status: 'in_progress' }))).toMatchObject({ state: 'unavailable', canRespond: false, canNavigate: false });
  });

  it('offered → withdraw; withdrawn → can offer again', () => {
    expect(helperView(viewer({ myRole: 'helper', responses: [response('a', 'offered')] }))).toMatchObject({ state: 'offered', canWithdraw: true, canMarkArrived: false });
    expect(helperView(viewer({ responses: [response('a', 'withdrawn')] }))).toMatchObject({ state: 'can_offer', canRespond: true });
  });

  it('accepted → arrived, navigate, SOS chat, requester phone', () => {
    const v = helperView(viewer({ myRole: 'helper', status: 'accepted', chatId: 'c9', contactPhone: '+7701', responses: [response('a', 'accepted')] }));
    expect(v).toMatchObject({ state: 'accepted', canMarkArrived: true, canWithdraw: true, canNavigate: true, callPhone: '+7701', message: { kind: 'sos_chat', chatId: 'c9' } });
    expect(helperView(viewer({ myRole: 'helper', status: 'in_progress', chatId: 'c9', responses: [response('a', 'arrived')] }))).toMatchObject({
      state: 'arrived',
      canWithdraw: false,
      canMarkArrived: false,
    });
  });

  it('declined and ended states hide actions', () => {
    expect(helperView(viewer({ responses: [response('a', 'declined')] }))).toMatchObject({ state: 'declined', message: null, callPhone: null });
    expect(helperView(viewer({ status: 'closed', responses: [response('a', 'arrived')] }))).toMatchObject({ state: 'ended', canRespond: false, message: null });
  });
});
