import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { alertFromNotification, createSosAlertStore } from './alerts';
import { applySosToCache, applyToActive, applyToMapItems, applyToNearby, sosKeys, type SosMapData } from './cache';
import { response, sos } from './fixtures';

describe('map layer', () => {
  it('inserts on sos:new, updates in place, removes when ended or own', () => {
    const viewerSos = sos({ myRole: 'viewer' });
    const inserted = applyToMapItems([], viewerSos, true);
    expect(inserted.map((i) => i.id)).toEqual(['s1']);
    expect(applyToMapItems([], viewerSos, false)).toEqual([]);
    expect(applyToMapItems(inserted, { ...viewerSos, status: 'accepted' }, false)[0]!.status).toBe('accepted');
    expect(applyToMapItems(inserted, { ...viewerSos, status: 'closed' }, false)).toEqual([]);
    expect(applyToMapItems([], sos({ myRole: 'requester' }), true)).toEqual([]);
  });
});

describe('nearby and active lists', () => {
  it('keeps nearby sorted by distance and drops ended SOS', () => {
    const a = sos({ id: 'a', myRole: 'viewer', distanceM: 3000 });
    const b = sos({ id: 'b', myRole: 'viewer', distanceM: 500 });
    expect(applyToNearby([a], b, true).map((s) => s.id)).toEqual(['b', 'a']);
    expect(applyToNearby([a, b], { ...a, status: 'cancelled' }, false).map((s) => s.id)).toEqual(['b']);
  });
  it('active = open and mine, or with a live response', () => {
    const offered = sos({ id: 'x', myRole: 'helper', responses: [response('r', 'offered')] });
    expect(applyToActive([], offered).map((s) => s.id)).toEqual(['x']);
    expect(applyToActive([offered], { ...offered, responses: [response('r', 'withdrawn')] })).toEqual([]);
    expect(applyToActive([], sos({ status: 'closed' }))).toEqual([]);
  });
});

describe('applySosToCache', () => {
  it('writes the detail and patches cached map lists', () => {
    const qc = new QueryClient();
    qc.setQueryData<SosMapData>(sosKeys.map('bbox'), { items: [] });
    const s = sos({ myRole: 'viewer' });
    applySosToCache(qc, s, 'new');
    expect(qc.getQueryData(sosKeys.detail('s1'))).toEqual(s);
    expect(qc.getQueryData<SosMapData>(sosKeys.map('bbox'))!.items).toHaveLength(1);
    applySosToCache(qc, { ...s, status: 'expired' }, 'update');
    expect(qc.getQueryData<SosMapData>(sosKeys.map('bbox'))!.items).toHaveLength(0);
  });
});

describe('alerts', () => {
  it('dedupes by SOS, merges details, and remembers dismissals', () => {
    const store = createSosAlertStore();
    store.push({ sosId: 'a', type: 'fuel', distanceM: null, requesterName: null, at: 1 });
    store.push({ sosId: 'a', type: 'fuel', distanceM: 800, requesterName: 'Aidar', at: 2 });
    expect(store.get()).toHaveLength(1);
    expect(store.get()[0]).toMatchObject({ distanceM: 800, requesterName: 'Aidar' });
    store.dismiss('a');
    store.push({ sosId: 'a', type: 'fuel', distanceM: 800, requesterName: 'Aidar', at: 3 });
    expect(store.get()).toHaveLength(0);
  });
  it('reads sos_nearby payloads defensively', () => {
    expect(
      alertFromNotification({ type: 'sos_nearby', payload: { sosId: 'abc-1', type: 'battery', distanceM: 1200, requester: { id: 'u', name: 'Dana', nickname: 'dana' } } }, 5),
    ).toEqual({ sosId: 'abc-1', type: 'battery', distanceM: 1200, requesterName: 'Dana', at: 5 });
    expect(alertFromNotification({ type: 'sos_nearby', payload: { sosId: '../x' } })).toBeNull();
    expect(alertFromNotification({ type: 'sos_response', payload: { sosId: 'a' } })).toBeNull();
    expect(alertFromNotification({ type: 'sos_nearby', payload: { sosId: 'a', type: 'weird' } })?.type).toBe('other');
  });
});
