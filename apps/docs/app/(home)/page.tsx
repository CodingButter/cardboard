import type { SVGProps } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  BookOpen,
  Boxes,
  Cog,
  ExternalLink,
  Globe,
  Hammer,
  Layers,
  MonitorPlay,
  MousePointer2,
  Network,
  PenTool,
  Puzzle,
  ShoppingBag,
  Sparkles,
  Store,
  Terminal,
  Workflow,
  Wrench,
  Zap,
} from 'lucide-react';
import { CodeSnippet } from '@/components/landing/CodeSnippet';
import { FeatureCard } from '@/components/landing/FeatureCard';
import { PlanLinkCard } from '@/components/landing/PlanLinkCard';
import { gitConfig } from '@/lib/shared';

/**
 * GitHub Pages serves the docs site at `/cardboard/...`, so the embedded
 * game runner lives at `/cardboard/play/`. Next.js's `basePath` prefix
 * auto-applies to internal `<Link>` and `<Image>` routes, but it does
 * NOT rewrite raw `src` attributes on `<iframe>`, so we hardcode the
 * production-deployed path here. In `next dev` (where `basePath` is
 * still `/cardboard`) the path is correct too — but the iframe will 404
 * unless the static game bundle has been staged into `public/play/`.
 * The `prebuild` step does that, so it works once you've run any
 * `bun run build`.
 */
const PLAY_BASE = '/cardboard/play';
const PLAY_SRC = `${PLAY_BASE}/?pack=${PLAY_BASE}/packs/default.apg`;

/**
 * cardboard documentation landing page.
 *
 * Audience: modders who'll write pack scripts against the ModAPI. The
 * page is structured top-down to lead with a runnable code sample, then
 * a feature grid pointing at the ModAPI surfaces a script can register
 * against, then distribution + quick start, then plan-doc deep dives
 * for people who want the architectural picture.
 *
 * All code shown is real — drawn from `packages/default-pack/scripts/`
 * with light editing for legibility (mostly: dropping the demo-specific
 * guard rails so the snippet stands alone). Plan-doc links route via
 * Next's `Link` so the basePath (`/cardboard`) applies on GitHub Pages.
 */

// Inline GitHub mark — lucide-react v1.x doesn't ship a `Github` icon
// and we'd rather not pull a heavier dep for one SVG. Path data is the
// standard GitHub octicon.
function GithubIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.54-3.88-1.54-.52-1.34-1.28-1.7-1.28-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.21-1.49 3.18-1.18 3.18-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.7 5.4-5.27 5.68.41.36.78 1.05.78 2.12v3.14c0 .31.21.67.8.55C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z" />
    </svg>
  );
}

const HERO_CODE = `// scripts/scatter-ammo.js — a complete pack script
export default (api) => {
  api.registerPrefab("ammo_pack", ({ x, y }) => {
    const e = api.world.spawn();
    api.world
      .add(e, api.components.Position, new api.Vec2(x, y))
      .add(e, api.components.Sprite, { imageId: "ammo_pack", worldHeight: 0.4 })
      .add(e, api.components.Pickup, { itemId: "rifle_ammo", count: 30 });
    return e;
  });

  api.onWorldReady(() => {
    // Sprinkle 3 ammo packs around the map at scene-load time.
    for (let i = 0; i < 3; i++) {
      api.spawn("ammo_pack", {
        x: 2 + Math.random() * 8,
        y: 2 + Math.random() * 8,
      });
    }
  });
};
`;

const QUICKSTART_CODE = `bun install
bun run build-packs   # bundle packages/default-pack into apps/game/public/packs/
bun run dev           # open http://localhost:3000
`;

const REPO_URL = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;

export default function HomePage() {
  return (
    <div className="flex flex-col">
      {/* ───────────────────── 1. Hero ───────────────────── */}
      <section className="border-b">
        <div className="mx-auto w-full max-w-5xl px-6 pt-16 pb-12 sm:pt-24 sm:pb-16">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border bg-fd-card px-3 py-1 text-xs font-medium text-fd-muted-foreground">
            <Sparkles aria-hidden="true" className="h-3.5 w-3.5 text-fd-primary" />
            2.5D raycaster engine · scriptable, hot-loadable packs
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-fd-foreground sm:text-5xl md:text-6xl">
            cardboard
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-fd-muted-foreground sm:text-xl">
            Build browser games by writing scripts. Your pack hot-loads into
            the engine; the <span className="font-semibold text-fd-foreground">ModAPI</span> gives
            you ECS, rendering, input, and modals. The engine knows nothing
            about your game — every line of gameplay lives in your pack.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Link
              href="/docs/guides/writing-your-first-pack"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-fd-primary px-5 py-2.5 text-sm font-semibold text-fd-primary-foreground shadow-sm transition-colors hover:bg-fd-primary/90"
            >
              Write your first script
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
            <Link
              href="/docs/api"
              className="inline-flex items-center justify-center gap-2 rounded-lg border bg-fd-card px-5 py-2.5 text-sm font-semibold text-fd-foreground shadow-sm transition-colors hover:bg-fd-accent/40"
            >
              <BookOpen aria-hidden="true" className="h-4 w-4" />
              Browse the API
            </Link>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium text-fd-muted-foreground transition-colors hover:text-fd-foreground"
            >
              <GithubIcon className="h-4 w-4" />
              View on GitHub
              <ExternalLink aria-hidden="true" className="h-3.5 w-3.5 opacity-60" />
            </a>
          </div>
        </div>
      </section>

      {/* ──────────── 1b. Play in your browser ──────────── */}
      <section className="border-b bg-fd-muted/30">
        <div className="mx-auto w-full max-w-5xl px-6 py-14 sm:py-20">
          <div className="mb-6 flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-fd-primary">
              Try it now
            </span>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Play in your browser
            </h2>
            <p className="max-w-2xl text-fd-muted-foreground">
              The runner below is the same engine you'll script against,
              loading the default pack from this site. No install — just
              click in and move with{' '}
              <code className="rounded bg-fd-muted/60 px-1 py-0.5 font-mono text-sm">WASD</code>.
            </p>
          </div>
          <div className="overflow-hidden rounded-xl border bg-black shadow-sm">
            <iframe
              src={PLAY_SRC}
              title="cardboard demo"
              allow="pointer-lock; fullscreen; gamepad; screen-wake-lock"
              loading="lazy"
              className="block h-full w-full"
              style={{
                aspectRatio: '16 / 10',
                border: 0,
                width: '100%',
                background: '#0f172a',
              }}
            />
          </div>
          <p className="mt-3 text-sm text-fd-muted-foreground">
            Click the game to capture your mouse. Press{' '}
            <code className="rounded bg-fd-muted/60 px-1 py-0.5 font-mono text-xs">Esc</code>{' '}
            to release. Loading the demo pack (~26 MB) — first load may take a moment.
          </p>
        </div>
      </section>

      {/* ──────────── 2. Live code snippet ──────────── */}
      <section className="border-b">
        <div className="mx-auto w-full max-w-5xl px-6 py-14 sm:py-20">
          <div className="mb-6 flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-fd-primary">
              What a script looks like
            </span>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Five lines of JavaScript. One file. Hot-reloadable.
            </h2>
            <p className="max-w-2xl text-fd-muted-foreground">
              A pack script is a default-export function that receives the
              engine's <code className="rounded bg-fd-muted/60 px-1 py-0.5 font-mono text-sm">api</code>{' '}
              object. Register prefabs, define systems, spawn entities — the
              engine wires them in alongside the built-in pipeline.
            </p>
          </div>
          <CodeSnippet code={HERO_CODE} lang="js" title="scripts/scatter-ammo.js" />
          <p className="mt-4 text-sm text-fd-muted-foreground">
            That's a complete pack script. Drop it in{' '}
            <code className="rounded bg-fd-muted/60 px-1 py-0.5 font-mono text-xs">scripts/</code>,
            register it in <code className="rounded bg-fd-muted/60 px-1 py-0.5 font-mono text-xs">manifest.json</code>,
            run the game — done. No build step. No engine fork.
          </p>
        </div>
      </section>

      {/* ──────────── 3. What scripts can do ──────────── */}
      <section className="border-b bg-fd-muted/30">
        <div className="mx-auto w-full max-w-5xl px-6 py-14 sm:py-20">
          <div className="mb-10 flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-fd-primary">
              The ModAPI surface
            </span>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              What scripts can do
            </h2>
            <p className="max-w-2xl text-fd-muted-foreground">
              Six primitives cover most of what gameplay needs. Mix them
              freely — the default pack uses every one.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <FeatureCard
              icon={<Workflow />}
              title="Register systems"
              description="Run logic every frame against entities matching a component query."
              snippet='api.registerSystem((world, dt) => { ... })'
            />
            <FeatureCard
              icon={<Boxes />}
              title="Spawn prefabs"
              description="Instantiate entities from named templates other scripts register."
              snippet='api.spawn("zombie", { x, y })'
            />
            <FeatureCard
              icon={<MousePointer2 />}
              title="Handle input"
              description="Read keyboard, mouse, and unified config-defined bindings."
              snippet='api.input.isBindingPressed(bindings.fire)'
            />
            <FeatureCard
              icon={<MonitorPlay />}
              title="Draw HUDs"
              description="Attach renderer systems to any of the engine's draw phases."
              snippet='api.registerRendererSystem(fn, "hud")'
            />
            <FeatureCard
              icon={<Layers />}
              title="Open modals"
              description="Coordinate UI state so pause, inventory, and dialogs don't fight."
              snippet='api.modals.setOpen("inventory", true)'
            />
            <FeatureCard
              icon={<Puzzle />}
              title="Define components"
              description="Extend the ECS with your own typed component classes."
              snippet='api.defineComponent("Health")'
            />
          </div>
        </div>
      </section>

      {/* ──────────── 4. Three ways to ship your pack ──────────── */}
      <section className="border-b">
        <div className="mx-auto w-full max-w-5xl px-6 py-14 sm:py-20">
          <div className="mb-10 flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-fd-primary">
              Distribution
            </span>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Three ways to ship your pack
            </h2>
            <p className="max-w-2xl text-fd-muted-foreground">
              Packs are{' '}
              <code className="rounded bg-fd-muted/60 px-1 py-0.5 font-mono text-sm">.apg</code>{' '}
              zips. The runner loads whichever one you point it at — pack
              substrate is the whole philosophy.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="flex flex-col gap-3 rounded-xl border bg-fd-card p-5 shadow-sm">
              <span
                aria-hidden="true"
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-fd-primary/10 text-fd-primary [&_svg]:h-4.5 [&_svg]:w-4.5"
              >
                <Terminal />
              </span>
              <h3 className="font-semibold tracking-tight">Run locally</h3>
              <p className="text-sm text-fd-muted-foreground">
                Drop the zip next to the runner and point the URL at it.
              </p>
              <code className="mt-auto block overflow-x-auto rounded-md border bg-fd-muted/50 px-2.5 py-1.5 font-mono text-xs">
                ?pack=/my-pack.apg
              </code>
            </div>
            <div className="flex flex-col gap-3 rounded-xl border bg-fd-card p-5 shadow-sm">
              <span
                aria-hidden="true"
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-fd-primary/10 text-fd-primary [&_svg]:h-4.5 [&_svg]:w-4.5"
              >
                <Globe />
              </span>
              <h3 className="font-semibold tracking-tight">Host anywhere</h3>
              <p className="text-sm text-fd-muted-foreground">
                Any HTTPS URL works. The runner fetches and verifies the
                manifest at boot.
              </p>
              <code className="mt-auto block overflow-x-auto rounded-md border bg-fd-muted/50 px-2.5 py-1.5 font-mono text-xs">
                ?pack=https://you.com/pack.apg
              </code>
            </div>
            <Link
              href="/docs/plans/STORE"
              className="group flex flex-col gap-3 rounded-xl border bg-fd-card p-5 shadow-sm transition-colors hover:bg-fd-accent/40 hover:border-fd-accent-foreground/20"
            >
              <span
                aria-hidden="true"
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-fd-primary/10 text-fd-primary [&_svg]:h-4.5 [&_svg]:w-4.5"
              >
                <Store />
              </span>
              <h3 className="font-semibold tracking-tight">
                Publish to the store{' '}
                <span className="text-xs font-medium text-fd-muted-foreground">
                  (planned)
                </span>
              </h3>
              <p className="text-sm text-fd-muted-foreground">
                Submit from the editor. Discoverable at{' '}
                <span className="font-mono text-xs">store.cardboard.gg</span>.
                Embed anywhere via iframe widget.
              </p>
              <span className="mt-auto inline-flex items-center gap-1.5 text-xs font-semibold text-fd-primary">
                Read the plan
                <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </span>
            </Link>
          </div>
        </div>
      </section>

      {/* ──────────── 5. Quick start ──────────── */}
      <section className="border-b bg-fd-muted/30">
        <div className="mx-auto w-full max-w-5xl px-6 py-14 sm:py-20">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 lg:items-center">
            <div className="flex flex-col gap-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-fd-primary">
                Develop locally
              </span>
              <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                Quick start — three commands
              </h2>
              <p className="text-fd-muted-foreground">
                Clone the repo, install deps, run the game runner. Scripts in{' '}
                <code className="rounded bg-fd-muted/60 px-1 py-0.5 font-mono text-sm">
                  packages/default-pack/scripts/
                </code>{' '}
                are live-reloaded — edit, save, see the change.
              </p>
              <div className="mt-2">
                <Link
                  href="/docs/guides/quick-start"
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-fd-primary hover:underline"
                >
                  Read the full Quick Start guide
                  <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
            <CodeSnippet
              code={QUICKSTART_CODE}
              lang="bash"
              title="terminal"
            />
          </div>
        </div>
      </section>

      {/* ──────────── 6. Explore the design ──────────── */}
      <section className="border-b">
        <div className="mx-auto w-full max-w-5xl px-6 py-14 sm:py-20">
          <div className="mb-10 flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-fd-primary">
              Where it's going
            </span>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Explore the design
            </h2>
            <p className="max-w-2xl text-fd-muted-foreground">
              cardboard ships every architectural plan as a public doc.
              Read what's coming, comment on the RFCs, or read the rationale
              behind decisions that already shipped.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <PlanLinkCard
              icon={<PenTool />}
              title="In-browser editor"
              href="/docs/plans/EDITOR"
              description="Live-mode pack authoring with Monaco, IndexedDB persistence, and round-trip export."
            />
            <PlanLinkCard
              icon={<Boxes />}
              title="Pack chain"
              href="/docs/plans/PACK_CHAIN"
              description="Manifest spec, dependency resolution, and override semantics for multi-pack composition."
            />
            <PlanLinkCard
              icon={<Wrench />}
              title="Custom shaders"
              href="/docs/plans/ENGINE_PACK_SHADERS"
              description="Pack-shipped shader overrides via role replacement and engine-defined hooks."
            />
            <PlanLinkCard
              icon={<Hammer />}
              title="Tile presets"
              href="/docs/plans/TILE_PRESETS"
              description="Preset-driven tile authoring — define a kind once, place it everywhere."
            />
            <PlanLinkCard
              icon={<ShoppingBag />}
              title="Community store"
              href="/docs/plans/STORE"
              description="Pack discovery, iframe game runner, embed-anywhere widget, per-pack PWA."
            />
            <PlanLinkCard
              icon={<Network />}
              title="Multiplayer"
              href="/docs/plans/MULTIPLAYER_PLAN"
              description="Networked play as a drop-in pack — auth, rooms, deterministic state, no engine changes."
            />
          </div>
        </div>
      </section>

      {/* ──────────── 7. Final CTA ──────────── */}
      <section>
        <div className="mx-auto w-full max-w-5xl px-6 py-16 sm:py-24">
          <div className="flex flex-col items-start gap-6 rounded-2xl border bg-fd-card p-8 shadow-sm sm:items-center sm:p-12 sm:text-center">
            <Zap aria-hidden="true" className="h-8 w-8 text-fd-primary" />
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Games as scripts. Ship a zip.
            </h2>
            <p className="max-w-2xl text-fd-muted-foreground">
              The engine is the platform. Your script is the game. Everything
              else — scenes, textures, items, weapons — is content the
              ModAPI lets you wire up however you want.
            </p>
            <div className="flex flex-wrap items-center gap-3 sm:justify-center">
              <Link
                href="/docs/api"
                className="inline-flex items-center gap-2 rounded-lg bg-fd-primary px-5 py-2.5 text-sm font-semibold text-fd-primary-foreground shadow-sm transition-colors hover:bg-fd-primary/90"
              >
                <BookOpen aria-hidden="true" className="h-4 w-4" />
                Browse the API reference
              </Link>
              <Link
                href="/docs/plans/ENGINE_PACK_SPLIT"
                className="inline-flex items-center gap-2 rounded-lg border bg-fd-card px-5 py-2.5 text-sm font-semibold text-fd-foreground shadow-sm transition-colors hover:bg-fd-accent/40"
              >
                <Cog aria-hidden="true" className="h-4 w-4" />
                Read the plan docs
              </Link>
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium text-fd-muted-foreground transition-colors hover:text-fd-foreground"
              >
                <GithubIcon className="h-4 w-4" />
                View on GitHub
                <ExternalLink aria-hidden="true" className="h-3.5 w-3.5 opacity-60" />
              </a>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
