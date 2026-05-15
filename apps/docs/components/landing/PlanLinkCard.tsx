import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { twMerge } from 'tailwind-merge';

/**
 * Card that links out to a plan doc under `/docs/plans/…`. Keeps the
 * landing page's "for the curious" grid visually distinct from the
 * feature grid (which is non-clickable): this one shows hover + an
 * arrow affordance.
 */
export function PlanLinkCard({
  icon,
  title,
  href,
  description,
  className,
}: {
  icon: ReactNode;
  title: string;
  href: string;
  description: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={twMerge(
        'group flex flex-col gap-2 rounded-xl border bg-fd-card p-5 shadow-sm transition-colors hover:bg-fd-accent/40 hover:border-fd-accent-foreground/20',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 text-fd-foreground">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-fd-primary/10 text-fd-primary [&_svg]:h-4.5 [&_svg]:w-4.5"
          >
            {icon}
          </span>
          <h3 className="font-semibold tracking-tight">{title}</h3>
        </div>
        <ArrowRight
          aria-hidden="true"
          className="h-4 w-4 text-fd-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-fd-foreground"
        />
      </div>
      <p className="text-sm text-fd-muted-foreground">{description}</p>
    </Link>
  );
}
