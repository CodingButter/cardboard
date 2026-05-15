import type { ReactNode } from 'react';
import { twMerge } from 'tailwind-merge';

/**
 * One feature in the "What scripts can do" grid.
 *
 * Visual: icon + title row, one-sentence description, and a single
 * line of `<code>` showing the actual ModAPI call. Styled to match the
 * Fumadocs `Card` look without inheriting `Card`'s link semantics —
 * these aren't navigable, they're educational.
 */
export function FeatureCard({
  icon,
  title,
  description,
  snippet,
  className,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  snippet: string;
  className?: string;
}) {
  return (
    <div
      className={twMerge(
        'flex flex-col gap-3 rounded-xl border bg-fd-card p-5 shadow-sm transition-colors hover:bg-fd-accent/40',
        className,
      )}
    >
      <div className="flex items-center gap-2.5 text-fd-foreground">
        <span
          aria-hidden="true"
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-fd-primary/10 text-fd-primary [&_svg]:h-4.5 [&_svg]:w-4.5"
        >
          {icon}
        </span>
        <h3 className="font-semibold tracking-tight">{title}</h3>
      </div>
      <p className="text-sm text-fd-muted-foreground">{description}</p>
      <code className="mt-auto block overflow-x-auto rounded-md border bg-fd-muted/50 px-2.5 py-1.5 font-mono text-xs text-fd-foreground">
        {snippet}
      </code>
    </div>
  );
}
