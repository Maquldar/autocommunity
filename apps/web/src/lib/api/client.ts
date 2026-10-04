import { ApiError, networkError, parseApiError } from './errors';
import type { Session } from './session';

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** JSON body. */
  json?: unknown;
  /** Multipart body (uploads). Mutually exclusive with `json`. */
  formData?: FormData;
  /** Send the bearer token (default true). Public routes pass false. */
  auth?: boolean;
  signal?: AbortSignal;
};

export type ApiClient = ReturnType<typeof createApiClient>;

/**
 * Typed fetch wrapper. On a 401 it refreshes the access token once (through the session's
 * single-flight refresh) and retries the request once. Errors are always ApiError.
 */
export function createApiClient({ baseUrl, fetch: doFetch, session }: { baseUrl: string; fetch: typeof fetch; session: Session }) {
  async function send(path: string, options: RequestOptions, token: string | null): Promise<Response> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    let body: BodyInit | undefined;
    if (options.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.json);
    } else if (options.formData) {
      body = options.formData;
    }
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      return await doFetch(`${baseUrl}${path}`, {
        method: options.method ?? 'GET',
        headers,
        body,
        // Auth routes set/clear the refresh cookie; the API's CORS allows credentials.
        credentials: 'include',
        signal: options.signal,
      });
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
      throw networkError(cause);
    }
  }

  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const authed = options.auth !== false;
    let token = authed ? session.getAccessToken() : null;
    if (authed && !token) {
      token = await session.refresh(null);
      if (!token) throw new ApiError({ status: 401, code: 'UNAUTHORIZED', message: 'Not signed in' });
    }

    let response = await send(path, options, token);
    if (authed && response.status === 401) {
      const fresh = await session.refresh(token);
      if (!fresh) throw await parseApiError(response);
      response = await send(path, options, fresh);
      if (response.status === 401) {
        // A brand-new token was rejected too: the session was revoked (e.g. log out everywhere).
        session.clear('expired');
      }
    }

    if (!response.ok) {
      const error = await parseApiError(response);
      if (authed && error.code === 'ACCOUNT_BLOCKED') session.markBlocked();
      throw error;
    }
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  return { request };
}
