/**
 * Push endpoints are URLs supplied by the client that the server later POSTs to, so they're restricted to
 * the browsers' push services (otherwise a subscription would be a server-side request forgery vector).
 */
const PUSH_SERVICE_HOST_SUFFIXES = [
  '.googleapis.com', // Chrome, Edge (FCM): fcm.googleapis.com
  '.mozilla.com', // Firefox: updates.push.services.mozilla.com
  '.push.apple.com', // Safari / iOS PWAs: web.push.apple.com
  '.notify.windows.com', // legacy Edge (WNS)
];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_SERVICE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}
