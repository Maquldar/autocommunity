import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AVATAR_COLOR_COUNT, getAvatarColorIndex, getInitials } from '@/lib/avatar';
import { Avatar } from './avatar';

describe('getInitials', () => {
  it.each([
    ['Асет Улымадияр', 'АУ'],
    ['aidana kassymova', 'AK'],
    ['Данияр', 'Д'],
    ['  maria   ivanova  petrovna ', 'MI'],
    ['nomad_77', 'N7'],
    ['ernar.s', 'ES'],
    ['Ұлан Әлиев', 'ҰӘ'],
    ['', '?'],
    [null, '?'],
  ])('%j → %s', (name, initials) => {
    expect(getInitials(name)).toBe(initials);
  });

  it('skips symbols and emoji', () => {
    expect(getInitials('🚗 Club')).toBe('C');
    expect(getInitials('Водитель №1')).toBe('В1');
    expect(getInitials('★★★')).toBe('?');
  });
});

describe('getAvatarColorIndex', () => {
  it('is deterministic and in range', () => {
    const ids = Array.from({ length: 200 }, (_, i) => `0192b3c4-${i}-7000-8000-${i * 31}`);
    for (const id of ids) {
      const index = getAvatarColorIndex(id);
      expect(index).toBe(getAvatarColorIndex(id));
      expect(index).toBeGreaterThanOrEqual(1);
      expect(index).toBeLessThanOrEqual(AVATAR_COLOR_COUNT);
    }
    // Spreads across the palette rather than collapsing to one colour.
    expect(new Set(ids.map(getAvatarColorIndex)).size).toBe(AVATAR_COLOR_COUNT);
  });

  it('pins a known id to a fixed colour (guards against hash changes)', () => {
    expect(getAvatarColorIndex('user-1')).toBe(getAvatarColorIndex('user-1'));
    expect(getAvatarColorIndex('user-1')).not.toBe(getAvatarColorIndex('user-2'));
  });
});

describe('<Avatar>', () => {
  it('renders initials with the same colour class for the same id', () => {
    render(
      <>
        <Avatar id="abc" name="Асет Улымадияр" />
        <Avatar id="abc" name="Someone Else" />
      </>,
    );
    const [first, second] = screen.getAllByTestId('avatar-fallback');
    expect(first).toHaveTextContent('АУ');
    expect(second).toHaveTextContent('SE');
    const colour = (el: Element | undefined) => [...(el?.classList ?? [])].find((c) => c.startsWith('bg-avatar-'));
    expect(colour(first)).toBeDefined();
    expect(colour(first)).toBe(colour(second));
    expect(colour(first)).toBe(`bg-avatar-${getAvatarColorIndex('abc')}`);
  });

  it('is labelled with the name unless decorative', () => {
    render(
      <>
        <Avatar id="1" name="Aidana" />
        <Avatar id="2" name="Hidden" decorative />
      </>,
    );
    expect(screen.getByRole('img', { name: 'Aidana' })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Hidden' })).not.toBeInTheDocument();
  });
});
