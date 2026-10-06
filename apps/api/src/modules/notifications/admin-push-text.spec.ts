import { describe, expect, it } from 'vitest';
import { pushPayloadFor } from './push-text';

const serviceId = '0192f0c0-0000-7000-8000-0000000000aa';

describe('pushPayloadFor (Phase 6 moderation types)', () => {
  it('admin_warning: the note for a warning; localized texts for block, SOS ban and fake SOS', () => {
    expect(pushPayloadFor('admin_warning', { kind: 'warning', note: 'Не спамьте', until: null, automatic: false }, 'ru')).toEqual({
      title: 'Предупреждение модератора',
      body: 'Не спамьте',
      url: '/notifications',
      tag: 'admin_warning:warning',
    });
    const until = '2026-10-08T06:00:00.000Z'; // 11:00 in Almaty
    expect(pushPayloadFor('admin_warning', { kind: 'blocked', note: null, until, automatic: true }, 'en')).toMatchObject({
      title: 'Account blocked',
      body: expect.stringContaining('11:00'),
    });
    expect(pushPayloadFor('admin_warning', { kind: 'blocked', note: 'x', until: null }, 'ru')!.body).toBe('Доступ к аккаунту ограничен');
    expect(pushPayloadFor('admin_warning', { kind: 'sos_ban', until }, 'ru')).toMatchObject({ title: 'SOS временно недоступен', body: expect.stringContaining('11:00') });
    expect(pushPayloadFor('admin_warning', { kind: 'fake_sos', sosId: 'x' }, 'en')!.title).toBe('SOS marked as fake');
    expect(pushPayloadFor('admin_warning', { kind: 'bogus' }, 'ru')).toBeNull();
  });

  it('report_resolved, service_status and visit_status with safe links', () => {
    expect(pushPayloadFor('report_resolved', { reportId: 'r-1', decision: 'confirmed' }, 'en')).toMatchObject({
      title: 'Report reviewed',
      tag: 'report:r-1',
      url: '/notifications',
    });
    expect(pushPayloadFor('report_resolved', { reportId: '../../x', decision: 'dismissed' }, 'en')).toBeNull();
    expect(pushPayloadFor('service_status', { serviceId, serviceName: 'Мойка', status: 'verified' }, 'ru')).toEqual({
      title: 'Сервис опубликован',
      body: '«Мойка» прошёл проверку и появился в каталоге',
      url: `/services/${serviceId}`,
      tag: `service:${serviceId}`,
    });
    expect(pushPayloadFor('service_status', { serviceId, serviceName: 'Wash', status: 'rejected' }, 'en')!.title).toBe('Service rejected');
    expect(pushPayloadFor('visit_status', { visitId: 'v', serviceId, serviceName: 'Wash', status: 'verified' }, 'en')).toMatchObject({
      title: 'Visit confirmed',
      body: 'You can now review “Wash”',
      url: `/services/${serviceId}`,
    });
    expect(pushPayloadFor('visit_status', { serviceName: 'Wash' }, 'en')).toBeNull();
  });
});
