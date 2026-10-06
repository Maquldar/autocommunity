import { describe, expect, it } from 'vitest';
import { safeHref, tokenize } from './links';

describe('tokenize (link detection)', () => {
  it('finds http(s) and www links, keeping surrounding text', () => {
    expect(tokenize('Отчёт: https://example.com/kolsai-report, фото тут www.photos.kz/a?b=1.')).toEqual([
      { type: 'text', value: 'Отчёт: ' },
      { type: 'link', value: 'https://example.com/kolsai-report', href: 'https://example.com/kolsai-report' },
      { type: 'text', value: ', фото тут ' },
      { type: 'link', value: 'www.photos.kz/a?b=1', href: 'https://www.photos.kz/a?b=1' },
      { type: 'text', value: '.' },
    ]);
  });

  it('keeps balanced parentheses and drops sentence punctuation', () => {
    expect(tokenize('(см. https://en.wikipedia.org/wiki/Lada_(brand))')).toEqual([
      { type: 'text', value: '(см. ' },
      { type: 'link', value: 'https://en.wikipedia.org/wiki/Lada_(brand)', href: 'https://en.wikipedia.org/wiki/Lada_(brand)' },
      { type: 'text', value: ')' },
    ]);
    expect(tokenize('Смотри http://a.kz!')[1]).toEqual({ type: 'link', value: 'http://a.kz', href: 'http://a.kz/' });
  });

  it('never links dangerous schemes and leaves markup as plain text', () => {
    const text = 'javascript:alert(1) <script>alert(1)</script> <a href="x">y</a> data:text/html,<b>';
    expect(tokenize(text)).toEqual([{ type: 'text', value: text }]);
    expect(tokenize('https://evil.example/"><img src=x onerror=alert(1)>')).toEqual([
      { type: 'link', value: 'https://evil.example/', href: 'https://evil.example/' },
      { type: 'text', value: '"><img src=x onerror=alert(1)>' },
    ]);
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('https://user:pass@evil.example')).toBeNull();
    expect(safeHref('http://localhost')).toBeNull();
  });

  it('plain text and empty input', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('Просто текст\nс переносом')).toEqual([{ type: 'text', value: 'Просто текст\nс переносом' }]);
  });
});
