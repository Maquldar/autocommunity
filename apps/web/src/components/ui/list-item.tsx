import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

type BaseProps = {
  title: ReactNode;
  description?: ReactNode;
  /** Avatar, icon tile, etc. */
  leading?: ReactNode;
  /** Badge, timestamp, Switch, count. */
  trailing?: ReactNode;
  className?: string;
  /** Hide the chevron that navigable rows show by default. */
  hideChevron?: boolean;
};

type LinkProps = BaseProps & { href: string; onClick?: never; disabled?: never };
type ButtonProps = BaseProps & { onClick: () => void; href?: never; disabled?: boolean };
type StaticProps = BaseProps & { href?: never; onClick?: never; disabled?: never };

export type ListItemProps = LinkProps | ButtonProps | StaticProps;

const rowClasses =
  'flex min-h-16 w-full items-center gap-3 px-4 py-3 text-start transition-colors duration-fast';
const interactiveClasses = 'hover:bg-accent focus-ring focus-visible:-outline-offset-2 disabled:opacity-50';

/**
 * One row of a list. Renders a Link (href), a button (onClick) or a plain div.
 * Never nest interactive controls inside a navigable row; put them in `trailing` of a static row instead.
 */
export function ListItem(props: ListItemProps) {
  const { title, description, leading, trailing, className, hideChevron } = props;
  const navigable = Boolean(props.href ?? props.onClick);

  const content = (
    <>
      {leading ? <span className="flex shrink-0 items-center">{leading}</span> : null}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[0.9375rem] font-medium text-foreground">{title}</span>
        {description ? <span className="line-clamp-2 text-sm text-muted-foreground">{description}</span> : null}
      </span>
      {trailing ? <span className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">{trailing}</span> : null}
      {navigable && !hideChevron ? (
        <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-muted-foreground rtl:rotate-180" />
      ) : null}
    </>
  );

  if (props.href !== undefined) {
    return (
      <Link href={props.href} className={cn(rowClasses, interactiveClasses, className)}>
        {content}
      </Link>
    );
  }
  if (props.onClick) {
    return (
      <button
        type="button"
        onClick={props.onClick}
        disabled={props.disabled}
        className={cn(rowClasses, interactiveClasses, className)}
      >
        {content}
      </button>
    );
  }
  return <div className={cn(rowClasses, className)}>{content}</div>;
}

/** Card-like container that separates ListItems with hairlines. */
export function ListGroup({ className, children, label }: { className?: string; children: ReactNode; label?: ReactNode }) {
  return (
    <section className={cn('flex flex-col gap-2', className)}>
      {label ? <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</h2> : null}
      <div className="overflow-hidden rounded-2xl border bg-card [&>*+*]:border-t">{children}</div>
    </section>
  );
}
