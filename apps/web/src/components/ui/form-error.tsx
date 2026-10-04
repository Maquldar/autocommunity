import { CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Form-level error (a failed submit that isn't about one field). Announced via role="alert". */
export function FormError({ children, className }: { children?: ReactNode; className?: string }) {
  if (!children) return null;
  return (
    <div
      role="alert"
      className={cn('flex items-start gap-2 rounded-xl bg-danger-soft px-3.5 py-3 text-sm text-danger-soft-foreground', className)}
    >
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}
