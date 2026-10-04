'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, type ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth/auth-provider';
import { HOME_ROUTE, ONBOARDING_ROUTE, safeNextPath } from '@/lib/routes';
import { CodeStep } from './code-step';
import { OAuthButtons } from './oauth-buttons';
import { PhoneStep } from './phone-step';
import { useOtpFlow } from './use-otp-flow';

const legalLink = (href: string) =>
  function LegalLink(chunks: ReactNode) {
    return (
      <Link href={href} className="font-medium text-primary underline-offset-4 hover:underline focus-ring rounded-sm">
        {chunks}
      </Link>
    );
  };

export function LoginView() {
  const t = useTranslations('auth');
  const { status, me, completeSignIn } = useAuth();
  const router = useRouter();
  const next = safeNextPath(useSearchParams().get('next'));
  const providers = useQuery({ queryKey: ['auth', 'providers'], queryFn: api.auth.providers, staleTime: Infinity, retry: 1 });
  const flow = useOtpFlow({ requestCode: api.auth.requestOtp, verifyCode: api.auth.verifyOtp, onVerified: completeSignIn });

  // Signed in (just now, or already when the page opened): continue to onboarding or the app.
  const user = status === 'authenticated' ? me.data : undefined;
  useEffect(() => {
    if (user) router.replace(user.onboardingCompleted ? (next ?? HOME_ROUTE) : ONBOARDING_ROUTE);
  }, [user, next, router]);

  if (status === 'loading' || status === 'authenticated') {
    return (
      <div aria-busy="true" className="flex flex-col gap-4 pt-2">
        <span className="sr-only">{t('signingIn')}</span>
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="mt-4 h-11 w-full rounded-lg" />
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
    );
  }

  const onCodeStep = flow.state.step === 'code';
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2 pt-2">
        <h1 className="text-2xl font-semibold leading-8 tracking-tight text-balance">
          {onCodeStep ? t('codeTitle') : t('title')}
        </h1>
        {onCodeStep ? null : <p className="text-[0.9375rem] text-muted-foreground text-pretty">{t('subtitle')}</p>}
      </header>

      {flow.state.step === 'code' ? (
        <CodeStep
          key={flow.state.phone}
          phone={flow.state.phone}
          devCode={flow.state.devCode}
          resendAt={flow.state.resendAt}
          onVerify={flow.verify}
          onResend={flow.resend}
          onChangeNumber={flow.changeNumber}
          submitLabel={t('signIn')}
        />
      ) : (
        <>
          <PhoneStep defaultPhone={flow.phone} onSubmit={flow.sendCode} submitLabel={t('getCode')} />
          {providers.data && (providers.data.google || providers.data.apple) ? (
            <>
              <div className="flex items-center gap-3 text-sm text-muted-foreground" role="separator">
                <span className="h-px flex-1 bg-border" />
                {t('or')}
                <span className="h-px flex-1 bg-border" />
              </div>
              <OAuthButtons providers={providers.data} onSignedIn={completeSignIn} />
            </>
          ) : null}
        </>
      )}

      <p className="text-sm text-muted-foreground text-pretty">
        {t.rich('consent', { terms: legalLink('/legal/terms'), privacy: legalLink('/legal/privacy') })}
      </p>
    </div>
  );
}
