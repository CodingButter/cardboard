/**
 * Tutorial system T1 — JSON schema types.
 *
 * Per `docs/plans/TUTORIALS.md` §3, a `.tutorial.json` is a flat array
 * of `Step` objects inside a top-level `Tutorial` record. T1 is the
 * minimal subset of the V1 schema: the runtime can drive a 3-step
 * spotlight walkthrough today, the rest of the schema fields are
 * gracefully optional / ignored.
 *
 * The schema string `"tutorial/1"` is pinned per §3.1 — the editor
 * will refuse unknown schemas (T2 hardening; T1 logs a warning).
 */

export type AdvanceKind = "click" | "key" | "event" | "timer" | "next";

/**
 * Discriminated union per §3.3. T1 implements all five primitive
 * kinds; the `any` / `all` composite kinds (§3.3.6) ship in T2+.
 */
export interface AdvanceCondition {
  kind: AdvanceKind;
  /** For `kind:"click"` — a CSS selector. Defaults to the step's
   *  `target` if omitted (the common case). For `kind:"event"` — the
   *  event name. For `kind:"key"` — the combo (e.g. "Cmd-S",
   *  "Enter"). */
  value?: string;
  /** For `kind:"timer"` — auto-advance after this many milliseconds.
   *  T1 cap is 10 000 ms (the schema validator can warn above that). */
  delayMs?: number;
}

/**
 * A single step. `target` accepts either a CSS selector OR a
 * registered tutorial-id (we look up `[data-tutorial-id="<value>"]`
 * first, then fall back to running the string through
 * `document.querySelector`). `null` is legal — viewport-centred
 * intro / outro splash steps.
 */
export interface TutorialStep {
  /** Optional stable id; defaults to step-<index>. */
  id?: string;
  /** CSS selector OR registered editor-element id. `null` = centred. */
  target: string | null;
  /** Speech bubble body. Plain text in T1; the V1 Markdown subset
   *  (bold, italic, code, kbd) lands in T2. */
  hint: string;
  /** What user action progresses to the next step. */
  advance: AdvanceCondition;
  /** Bubble anchor. T1 supports `auto`, `top`, `bottom`, `left`,
   *  `right`, `center`. Default `auto`. */
  placement?: "auto" | "top" | "bottom" | "left" | "right" | "center";
  /** Spotlight hole padding in px. Default 6. */
  highlightPadding?: number;
  /** Spotlight hole border radius in px. Default 8. */
  highlightRadius?: number;
}

/**
 * Top-level tutorial record. T1 requires `id`, `title`, and `steps`;
 * the rest are optional and reserved for T2+ wiring.
 */
export interface TutorialDef {
  /** Version pin — `"tutorial/1"` for V1. */
  $schema?: string;
  /** Globally unique slug (lowercase, dash-separated). */
  id: string;
  /** Human-readable label, ≤ 60 chars. */
  title: string;
  /** One-sentence summary, ≤ 140 chars. */
  description?: string;
  /** Author-provided estimate in seconds. Informational only. */
  estimatedSeconds?: number;
  /** Slug to chain to on completion (reserved for T2+). */
  next?: string | null;
  /** Slugs that must be completed first (reserved for T2+). */
  prerequisites?: string[];
  /** The walkthrough. T1 supports 1 ≤ steps.length ≤ 30. */
  steps: TutorialStep[];
}

/**
 * Result emitted by `api.tutorials.start()` when the overlay dismisses.
 */
export interface TutorialResult {
  id: string;
  status: "completed" | "skipped" | "stopped";
  durationMs: number;
  stepReached: number;
}

/**
 * The runtime-state machine that drives `<TutorialOverlay>`.
 * Surfaced via a tiny pub/sub so the overlay's host React tree (a
 * single mount near `<App/>`) can subscribe via `useSyncExternalStore`.
 */
export type RuntimeState =
  | { kind: "idle" }
  | {
      kind: "active";
      tutorial: TutorialDef;
      stepIndex: number;
      startedAt: number;
    };
