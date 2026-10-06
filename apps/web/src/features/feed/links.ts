/**
 * Splits post / comment text into plain-text and link tokens. Rendering stays in React text nodes (escaped),
 * so user text can never inject markup; only `http(s)` URLs become links, and `www.` gets `https://`.
 */
export type TextToken = { type: 'text'; value: string } | { type: 'link'; value: string; href: string };

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;
/** Punctuation that usually ends a sentence rather than the URL. */
const TRAILING = /[.,!?;:…»"')\]]+$/;

export function safeHref(raw: string): string | null {
  const candidate = /^www\./i.test(raw) ? `https://${raw}` : raw;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname.includes('.') || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

const NON_ASCII = /[^\x00-\x7f]/;

/**
 * Link text as shown to the reader. A host with non-ASCII characters (IDN, e.g. Cyrillic "а" in `аpple.com`)
 * is shown in its punycode form (`xn--pple-43d.com`) so a look-alike domain can't pass for a real one;
 * the rest of the text (path, query) is left as typed.
 */
export function displayLink(value: string, href: string): string {
  const prefix = value.match(/^(?:https?:\/\/)?/i)?.[0] ?? '';
  const rest = value.slice(prefix.length);
  const end = rest.search(/[/?#\\]/);
  const authority = end === -1 ? rest : rest.slice(0, end);
  if (!NON_ASCII.test(authority)) return value;
  return prefix + new URL(href).host + rest.slice(authority.length);
}

export function tokenize(text: string): TextToken[] {
  const tokens: TextToken[] = [];
  let last = 0;
  const push = (value: string) => {
    if (!value) return;
    const prev = tokens[tokens.length - 1];
    if (prev?.type === 'text') prev.value += value;
    else tokens.push({ type: 'text', value });
  };
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0;
    let value = match[0];
    // Keep balanced closing parentheses (Wikipedia-style URLs), drop sentence punctuation.
    let trailing = value.match(TRAILING)?.[0] ?? '';
    if (trailing.startsWith(')') && (value.match(/\(/g)?.length ?? 0) > (value.slice(0, -trailing.length).match(/\)/g)?.length ?? 0)) {
      trailing = trailing.slice(1);
    }
    value = trailing ? value.slice(0, -trailing.length) : value;
    const href = value.length > 4 ? safeHref(value) : null;
    push(text.slice(last, start));
    if (href) tokens.push({ type: 'link', value: displayLink(value, href), href });
    else push(value);
    push(trailing);
    last = start + match[0].length;
  }
  push(text.slice(last));
  return tokens;
}
