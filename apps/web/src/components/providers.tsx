'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { useState, type ReactNode } from 'react';
import { Toaster } from '@/components/ui/toaster';
import { AuthProvider } from '@/lib/auth/auth-provider';
import { makeQueryClient } from '@/lib/query-client';

/** Client-side providers. NextIntlClientProvider wraps this in the root layout (server). */
export function Providers({ children }: { children: ReactNode }) {
  // One client per browser session (and per request on the server) — never module-level.
  const [queryClient] = useState(makeQueryClient);
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>{children}</AuthProvider>
        <Toaster />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
