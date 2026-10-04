import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/** Shared look for text-like controls (Input, Textarea, Select trigger, OTP boxes). */
export const controlClasses = [
  'w-full rounded-lg border border-input bg-card text-foreground',
  // 16px text prevents iOS Safari from zooming into focused fields.
  'text-base placeholder:text-muted-foreground',
  'transition-[border-color,box-shadow] duration-fast ease-standard',
  'hover:border-foreground/40 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35',
  'disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-70',
  'aria-invalid:border-danger aria-invalid:focus-visible:ring-danger/30',
].join(' ');

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, type = 'text', ...props },
  ref,
) {
  return <input ref={ref} type={type} className={cn(controlClasses, 'h-11 px-3.5', className)} {...props} />;
});
