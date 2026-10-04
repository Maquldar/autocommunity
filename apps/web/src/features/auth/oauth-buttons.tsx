'use client';

import type { AuthProviders, AuthResult } from '@autoc/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';
import { useErrorMessage } from '@/hooks/use-error-message';
import { api } from '@/lib/api';

const GOOGLE_SCRIPT = 'https://accounts.google.com/gsi/client';
const APPLE_SCRIPT = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';

const scripts = new Map<string, Promise<void>>();

/** Loads an external script once per page. */
function loadScript(src: string): Promise<void> {
  const cached = scripts.get(src);
  if (cached) return cached;
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scripts.delete(src);
      reject(new Error(`Failed to load ${src}`));
    };
    document.head.appendChild(script);
  });
  scripts.set(src, promise);
  return promise;
}

type Props = {
  providers: AuthProviders;
  onSignedIn: (result: AuthResult) => void;
};

/**
 * Google / Apple sign-in. Rendered only for providers the API reports as configured
 * (GET /auth/providers); each yields an ID token that the API verifies.
 */
export function OAuthButtons({ providers, onSignedIn }: Props) {
  const errorMessage = useErrorMessage();
  const [error, setError] = useState<string | null>(null);

  async function exchange(signIn: () => Promise<AuthResult>) {
    setError(null);
    try {
      onSignedIn(await signIn());
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (!providers.google && !providers.apple) return null;
  return (
    <div className="flex flex-col gap-3">
      {providers.google ? (
        <GoogleButton clientId={providers.google.clientId} onIdToken={(idToken) => exchange(() => api.auth.google(idToken))} onError={setError} />
      ) : null}
      {providers.apple ? (
        <AppleButton
          clientId={providers.apple.clientId}
          redirectUri={providers.apple.redirectUri}
          onIdToken={(idToken, name) => exchange(() => api.auth.apple(idToken, name))}
          onError={setError}
        />
      ) : null}
      <FormError>{error}</FormError>
    </div>
  );
}

function GoogleButton({ clientId, onIdToken, onError }: { clientId: string; onIdToken: (idToken: string) => void; onError: (message: string) => void }) {
  const t = useTranslations('auth');
  const container = useRef<HTMLDivElement>(null);
  const locale = useLocale();
  const { resolvedTheme } = useTheme();
  // GIS keeps the callback from initialize(); route it through a ref so it always sees fresh props.
  const callback = useRef(onIdToken);
  callback.current = onIdToken;

  useEffect(() => {
    let cancelled = false;
    loadScript(GOOGLE_SCRIPT)
      .then(() => {
        const node = container.current;
        const gis = window.google?.accounts.id;
        if (cancelled || !node || !gis) return;
        gis.initialize({ client_id: clientId, ux_mode: 'popup', callback: (response) => callback.current(response.credential) });
        node.replaceChildren();
        gis.renderButton(node, {
          type: 'standard',
          theme: resolvedTheme === 'dark' ? 'filled_black' : 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'pill',
          width: Math.min(400, node.offsetWidth),
          locale,
        });
      })
      .catch(() => {
        if (!cancelled) onError(t('oauthUnavailable'));
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, locale, resolvedTheme, onError, t]);

  return <div ref={container} className="flex min-h-11 w-full justify-center" data-testid="google-signin" />;
}

function AppleButton({
  clientId,
  redirectUri,
  onIdToken,
  onError,
}: {
  clientId: string;
  redirectUri: string;
  onIdToken: (idToken: string, name?: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const t = useTranslations('auth');
  const [pending, setPending] = useState(false);

  async function signIn() {
    setPending(true);
    try {
      await loadScript(APPLE_SCRIPT);
      const apple = window.AppleID;
      if (!apple) throw new Error('AppleID unavailable');
      apple.auth.init({ clientId, redirectURI: redirectUri, scope: 'name email', usePopup: true });
      let response: AppleSignInResponse;
      try {
        response = await apple.auth.signIn();
      } catch {
        return; // Popup closed or cancelled by the user.
      }
      // Apple sends the name only on the very first authorization.
      const name = [response.user?.name?.firstName, response.user?.name?.lastName].filter(Boolean).join(' ') || undefined;
      await onIdToken(response.authorization.id_token, name);
    } catch {
      onError(t('oauthUnavailable'));
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      variant="outline"
      size="lg"
      fullWidth
      loading={pending}
      onClick={signIn}
      leadingIcon={
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
          <path d="M16.37 12.6c-.02-2.2 1.8-3.26 1.88-3.31-1.03-1.5-2.62-1.7-3.18-1.73-1.35-.14-2.64.8-3.33.8-.69 0-1.74-.78-2.87-.76-1.47.02-2.83.86-3.59 2.18-1.53 2.66-.39 6.6 1.1 8.76.73 1.06 1.6 2.24 2.73 2.2 1.1-.05 1.51-.71 2.84-.71 1.32 0 1.7.71 2.86.69 1.18-.02 1.93-1.07 2.65-2.13.84-1.22 1.18-2.41 1.2-2.47-.03-.01-2.3-.88-2.32-3.52zM14.2 6.13c.6-.73 1.01-1.75.9-2.76-.87.03-1.92.58-2.54 1.31-.56.65-1.05 1.68-.92 2.68.97.07 1.96-.5 2.56-1.23z" />
        </svg>
      }
    >
      {t('continueWithApple')}
    </Button>
  );
}
