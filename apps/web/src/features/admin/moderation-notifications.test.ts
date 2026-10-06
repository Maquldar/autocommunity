import { describe, expect, it } from 'vitest';
import { describeNotification } from '@/features/notifications/describe';

const serviceId = '0192a6c5-1234-7abc-8def-0123456789ab';

describe('describeNotification (Phase 6 moderation types)', () => {
  it('admin_warning keeps the note and a valid until', () => {
    expect(describeNotification({ type: 'admin_warning', payload: { kind: 'warning', note: 'Не спамьте', until: null } })).toEqual({
      kind: 'moderation',
      variant: 'warning',
      note: 'Не спамьте',
      until: null,
      serviceName: '',
      href: null,
    });
    const v = describeNotification({ type: 'admin_warning', payload: { kind: 'sos_ban', until: '2026-10-08T00:00:00Z' } });
    expect(v).toMatchObject({ variant: 'sos_ban', until: '2026-10-08T00:00:00Z' });
    expect(describeNotification({ type: 'admin_warning', payload: { kind: 'blocked', until: 'garbage' } })).toMatchObject({ until: null });
    expect(describeNotification({ type: 'admin_warning', payload: { kind: 'other' } }).kind).toBe('generic');
  });

  it('report_resolved, service_status and visit_status map to variants with safe links', () => {
    expect(describeNotification({ type: 'report_resolved', payload: { reportId: 'r', decision: 'confirmed' } })).toMatchObject({ variant: 'report_confirmed' });
    expect(describeNotification({ type: 'report_resolved', payload: { reportId: 'r', decision: 'dismissed' } })).toMatchObject({ variant: 'report_dismissed' });
    expect(describeNotification({ type: 'service_status', payload: { serviceId, serviceName: 'Мойка', status: 'verified' } })).toMatchObject({
      variant: 'service_verified',
      serviceName: 'Мойка',
      href: `/services/${serviceId}`,
    });
    expect(describeNotification({ type: 'visit_status', payload: { serviceId: '../x', status: 'rejected' } })).toMatchObject({ variant: 'visit_rejected', href: null });
    expect(describeNotification({ type: 'visit_status', payload: { status: 'weird' } }).kind).toBe('generic');
  });
});

describe('audit action message keys', () => {
  it('replaces the dot (next-intl would read it as nesting)', async () => {
    const { actionKey } = await import('./audit-view');
    expect(actionKey('user.block')).toBe('user_block');
    expect(actionKey('sos.mark_fake')).toBe('sos_mark_fake');
  });
});
