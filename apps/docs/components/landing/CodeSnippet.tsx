import { highlight } from 'fumadocs-core/highlight';
import { Pre } from 'fumadocs-ui/components/codeblock';
import { twMerge } from 'tailwind-merge';

/**
 * Server-rendered, syntax-highlighted code block for the landing page.
 *
 * Wraps `fumadocs-core/highlight` (which calls into shiki) so the output
 * matches the rest of the docs site visually — same `--shiki-*` CSS
 * variables, same `<Pre>` styling Fumadocs uses for MDX-rendered code
 * blocks. The component is async; Next renders it during static export.
 *
 * The wrapper element is a `<figure>` so screen readers identify it as
 * a self-contained code sample, and an optional `title` row (filename
 * pill) mirrors Fumadocs' MDX `title="…"` affordance.
 */
export async function CodeSnippet({
  code,
  lang,
  title,
  className,
}: {
  code: string;
  lang: 'js' | 'ts' | 'tsx' | 'sh' | 'bash' | 'json';
  title?: string;
  className?: string;
}) {
  // Default themes (`github-light` + `github-dark`) come from
  // `applyDefaultThemes` inside `fumadocs-core/highlight` — that matches
  // what the MDX renderer uses elsewhere on the site, so the colors
  // here are pixel-identical to what readers see in `/docs/*`.
  const rendered = await highlight(code, {
    lang,
    components: {
      // Override the `<pre>` to use Fumadocs' Pre so our scroll styling
      // matches the MDX-rendered code blocks.
      pre: (props) => <Pre {...props} />,
    },
  });

  return (
    <figure
      className={twMerge(
        'shiki not-prose relative my-0 overflow-hidden rounded-xl border bg-fd-card text-sm shadow-sm',
        className,
      )}
    >
      {title ? (
        <figcaption className="flex h-9.5 items-center gap-2 border-b px-4 text-fd-muted-foreground">
          <span className="truncate font-mono text-xs">{title}</span>
        </figcaption>
      ) : null}
      <div className="overflow-auto py-3.5 text-[0.8125rem]">{rendered}</div>
    </figure>
  );
}
