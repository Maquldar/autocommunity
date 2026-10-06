import { describe, expect, it } from 'vitest';
import { displayLink, safeHref, tokenize } from './links';

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

describe('IDN look-alike protection', () => {
  it('shows a non-ASCII host in punycode, keeping the rest of the text', () => {
    expect(tokenize('https://аpple.com')).toEqual([{ type: 'link', value: 'https://xn--pple-43d.com', href: 'https://xn--pple-43d.com/' }]);
    expect(tokenize('см. www.аpple.com/путь?q=1.')).toEqual([
      { type: 'text', value: 'см. ' },
      { type: 'link', value: 'www.xn--pple-43d.com/путь?q=1', href: 'https://www.xn--pple-43d.com/%D0%BF%D1%83%D1%82%D1%8C?q=1' },
      { type: 'text', value: '.' },
    ]);
    expect(displayLink('http://пример.рф:8080/a', 'http://xn--e1afmkfd.xn--p1ai:8080/a')).toBe('http://xn--e1afmkfd.xn--p1ai:8080/a');
  });

  it('leaves ASCII hosts as typed', () => {
    expect(displayLink('HTTPS://Example.com/Путь', 'https://example.com/%D0%9F%D1%83%D1%82%D1%8C')).toBe('HTTPS://Example.com/Путь');
  });
});
