import { describe, expect, it } from 'vitest';
import { createEventSchema, eventEndsAt, eventTimeIssues } from './events';
import { createPostSchema, pollVoteSchema, textPreview } from './feed';

const soon = () => new Date(Date.now() + 3600_000).toISOString();

describe('events schemas', () => {
  it('accepts a valid event and rejects bad times and routes', () => {
    const ok = createEventSchema.safeParse({ title: 'Meetup', place: 'Mega', lat: 43.2, lng: 76.9, startsAt: soon(), route: [[76.9, 43.2], [77, 43.3]] });
    expect(ok.success).toBe(true);
    expect(createEventSchema.safeParse({ title: 'Meetup', place: 'Mega', lat: 43.2, lng: 76.9, startsAt: 'x' }).success).toBe(false);
    expect(createEventSchema.safeParse({ title: 'Meetup', place: 'Mega', lat: 43.2, lng: 76.9, startsAt: soon(), route: [[76.9, 43.2]] }).success).toBe(false);
  });
  it('time rules and default duration', () => {
    const now = Date.UTC(2026, 0, 1);
    expect(eventTimeIssues(new Date(now - 1), null, now)).toHaveLength(1);
    expect(eventTimeIssues(new Date(now + 1000), new Date(now + 500), now).map((i) => i.path)).toEqual(['endsAt']);
    expect(eventEndsAt({ startsAt: '2026-01-01T00:00:00.000Z', endsAt: null }).toISOString()).toBe('2026-01-01T03:00:00.000Z');
  });
});

describe('feed schemas', () => {
  it('needs content; poll options distinct; trims', () => {
    expect(createPostSchema.safeParse({}).success).toBe(false);
    expect(createPostSchema.safeParse({ text: '  hi ' }).data?.text).toBe('hi');
    expect(createPostSchema.safeParse({ poll: { question: 'Where?', options: ['A', 'a'] } }).success).toBe(false);
    expect(createPostSchema.safeParse({ poll: { question: 'Where?', options: ['A', 'B'] } }).data?.poll?.multiple).toBe(false);
    expect(pollVoteSchema.safeParse({ optionIds: [] }).success).toBe(false);
  });
  it('textPreview', () => {
    expect(textPreview('a\n\n b')).toBe('a b');
    expect(textPreview('x'.repeat(200))).toHaveLength(120);
  });
});
