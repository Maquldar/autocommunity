'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-provider';
import { HOME_ROUTE, LOGIN_ROUTE } from '@/lib/routes';

/** "Get started": /login for guests, straight into the app once the session is restored. */
export function GetStartedButton({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  return (
    <Button asChild size="xl" trailingIcon={<ArrowRight aria-hidden="true" className="rtl:rotate-180" />}>
      <Link href={status === 'authenticated' ? HOME_ROUTE : LOGIN_ROUTE}>{children}</Link>
    </Button>
  );
}
