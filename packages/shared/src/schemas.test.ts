import { describe, expect, it } from 'vitest';
import { nicknameSchema, updateMeSchema } from './schemas';

describe('profile text validation', () => {
  it.each(['Асет\u200B', 'A\u202Eb', 'Na\uFEFFme', 'Line\nbreak', 'tab\tname', '\u0007bell'])('rejects name %j', (name) =>
    expect(updateMeSchema.safeParse({ name }).success).toBe(false),
  );

  it('requires a letter or digit in names', () => {
    expect(updateMeSchema.safeParse({ name: '...' }).success).toBe(false);
    expect(updateMeSchema.safeParse({ name: '\u200D' }).success).toBe(false);
    expect(updateMeSchema.safeParse({ name: 'Айгерим 🚗' }).success).toBe(true);
  });

  it('allows multi-line bios and emoji ZWJ sequences but not invisible characters', () => {
    expect(updateMeSchema.safeParse({ bio: 'Line 1\nLine 2 👨\u200D👩\u200D👧' }).success).toBe(true);
    expect(updateMeSchema.safeParse({ bio: 'hidden\u200Btext' }).success).toBe(false);
  });

  it('nickname needs at least one letter or digit', () => {
    expect(nicknameSchema.safeParse('___').success).toBe(false);
    expect(nicknameSchema.safeParse('._.').success).toBe(false);
    expect(nicknameSchema.safeParse('a__').success).toBe(true);
  });
});

import { communityNameKey, createCommunitySchema, normalizeCommunityName } from './communities';

describe('community names', () => {
  it('normalizes NFKC, whitespace, trailing punctuation; keys are case-insensitive', () => {
    const base = 'Cafe Club';
    const variants = ['Cafe Club', 'CAFE CLUB', '  Cafe Club  ', 'Cafe  Club', 'Cafe\u00a0Club', 'Ｃafe Club', 'Cafe\u3000Club', 'Cafe Club.', 'Cafe Club!!!'];
    for (const v of variants) expect(communityNameKey(v)).toBe('cafe club');
    expect(communityNameKey('Café Club'.normalize('NFD'))).toBe(communityNameKey('Café Club'.normalize('NFC')));
    expect(normalizeCommunityName('  Night   Drive!  ')).toBe('Night Drive');
    expect(createCommunitySchema.parse({ name: ' Ｔoyota  Club. ', isPrivate: false }).name).toBe('Toyota Club');
    // Confusables are out of scope: Cyrillic С stays different.
    expect(communityNameKey('\u0421afe Club')).not.toBe(communityNameKey(base));
    expect(createCommunitySchema.safeParse({ name: '!!!', isPrivate: false }).success).toBe(false);
    expect(createCommunitySchema.safeParse({ name: 'Ab.', isPrivate: false }).success).toBe(false);
  });
});

describe('admin schemas (security review additions)', () => {
  it('accepts the reciprocal_sos fraud flag filter and lists the content-removal audit action', async () => {
    const { adminFraudFlagsQuerySchema, ADMIN_ACTIONS, FRAUD_FLAG_KINDS } = await import('./admin');
    expect(FRAUD_FLAG_KINDS).toContain('reciprocal_sos');
    expect(ADMIN_ACTIONS).toContain('report.remove_content');
    expect(adminFraudFlagsQuerySchema.safeParse({ kind: 'reciprocal_sos' }).success).toBe(true);
    expect(adminFraudFlagsQuerySchema.safeParse({ kind: 'nope' }).success).toBe(false);
  });

  it('the report preview may carry the post to open', async () => {
    const preview: import('./admin').ReportTargetPreview = { title: null, text: 'x', imageUrl: null, deleted: false, postId: '0192a6c5-1234-7abc-8def-0123456789ab' };
    expect(preview.postId).toBeTruthy();
  });
});
