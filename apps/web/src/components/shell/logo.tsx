import { cn } from '@/lib/cn';

/**
 * Brand mark: a map pin holding a steering wheel — "drivers on the map".
 * Same geometry as public/icons/icon.svg (scripts/generate-icons.mjs).
 */
export function LogoMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 512 512"
      className={cn('size-8 shrink-0', className)}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <rect width="512" height="512" rx="120" fill="var(--logo-bg, #1f5ae0)" />
      <path
        d="M256 430c-8 0-14-4-19-10-46-55-109-124-109-196a128 128 0 0 1 256 0c0 72-63 141-109 196-5 6-11 10-19 10z"
        fill="#fff"
      />
      <circle cx="256" cy="222" r="76" fill="none" stroke="var(--logo-bg, #1f5ae0)" strokeWidth="24" />
      <path d="M182 232h148M256 232v64" fill="none" stroke="var(--logo-bg, #1f5ae0)" strokeWidth="22" />
      <circle cx="256" cy="232" r="27" fill="var(--logo-bg, #1f5ae0)" />
    </svg>
  );
}

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark />
      {compact ? null : (
        <span className="text-[1.0625rem] font-semibold tracking-tight text-foreground">
          Auto<span className="text-primary">Community</span>
        </span>
      )}
    </span>
  );
}
