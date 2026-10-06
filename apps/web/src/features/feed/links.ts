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
    if (href) tokens.push({ type: 'link', value, href });
    else push(value);
    push(trailing);
    last = start + match[0].length;
  }
  push(text.slice(last));
  return tokens;
}
