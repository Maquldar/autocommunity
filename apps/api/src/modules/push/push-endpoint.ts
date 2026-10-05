import { parse as legacyParse } from 'node:url';

/**
 * Push endpoints are client-supplied URLs the server later POSTs to, so they're limited to the browsers'
 * push services (anything else would be a server-side request forgery vector).
 *
 * web-push sends with the legacy `url.parse`, which reads some hosts differently from WHATWG `URL`
 * (e.g. `https://127.0.0.1;.googleapis.com/x` → legacy host `127.0.0.1`). So the host must be plain
 * `[a-z0-9.-]`, both parsers must agree on it, and the normalized href is what gets stored and sent.
 */
const EXACT_HOSTS = new Set(['fcm.googleapis.com', 'updates.push.services.mozilla.com']);
const HOST_SUFFIXES = ['.push.services.mozilla.com', '.push.apple.com', '.notify.windows.com'];

const HOST_RE = /^[a-z0-9.-]+$/;
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Returns the normalized endpoint URL, or null when it isn't an allowed push service URL. */
export function normalizePushEndpoint(endpoint: string): string | null {
  // No whitespace, control characters, quotes, backslashes or other characters URL parsers disagree on.
  if (!/^[\x21-\x7e]+$/.test(endpoint) || /["'`\\{}<>^|]/.test(endpoint)) return null;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port !== '' && url.port !== '443')) return null;
  const host = url.hostname;
  if (!HOST_RE.test(host) || IPV4_RE.test(host) || host.startsWith('.') || host.endsWith('.') || host.includes('..')) return null;
  if (!EXACT_HOSTS.has(host) && !HOST_SUFFIXES.some((s) => host.endsWith(s))) return null;
  const href = url.href;
  // What web-push will actually connect to.
  for (const candidate of [endpoint, href]) {
    const legacy = legacyParse(candidate);
    if (legacy.protocol !== 'https:' || legacy.hostname !== host || legacy.auth || (legacy.port !== null && legacy.port !== '443')) return null;
  }
  return href;
}

export const isAllowedPushEndpoint = (endpoint: string): boolean => normalizePushEndpoint(endpoint) !== null;
