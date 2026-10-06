'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/cn';
import { tokenize } from './links';

/** User text with clickable http(s) links. Everything renders as React text nodes (escaped): no HTML. */
export function RichText({ text, className }: { text: string; className?: string }) {
  const tokens = useMemo(() => tokenize(text), [text]);
  return (
    <p className={cn('whitespace-pre-wrap text-[0.9375rem] leading-relaxed [overflow-wrap:anywhere]', className)}>
      {tokens.map((token, i) =>
        token.type === 'link' ? (
          <a key={i} href={token.href} target="_blank" rel="noopener noreferrer nofollow ugc" className="text-primary underline underline-offset-2 focus-ring rounded-sm">
            {token.value}
          </a>
        ) : (
          <span key={i}>{token.value}</span>
        ),
      )}
    </p>
  );
}
