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
