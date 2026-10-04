import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import ru from '../../messages/ru.json';

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  return Object.fromEntries(
    Object.entries(tree).flatMap(([key, value]) =>
      typeof value === 'string' ? [[`${prefix}${key}`, value]] : Object.entries(flatten(value, `${prefix}${key}.`)),
    ),
  );
}

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort();

describe('message catalogs', () => {
  const enFlat = flatten(en);
  const ruFlat = flatten(ru);

  it('ru and en have exactly the same keys', () => {
    expect(Object.keys(ruFlat).sort()).toEqual(Object.keys(enFlat).sort());
  });

  it('ru and en use the same ICU placeholders', () => {
    for (const [key, text] of Object.entries(enFlat)) {
      expect.soft(placeholders(ruFlat[key] ?? ''), key).toEqual(placeholders(text));
    }
  });

  it('has no empty strings', () => {
    for (const [key, text] of [...Object.entries(enFlat), ...Object.entries(ruFlat)]) {
      expect.soft(text.trim(), key).not.toBe('');
    }
  });
});
