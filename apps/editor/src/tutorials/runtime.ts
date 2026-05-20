/**
 * Tutorial system T1 — runtime registry + active-tutorial state machine.
 *
 * Surface (per TUTORIALS.md §4.3):
 *   - `api.tutorials.has(id)` / `get(id)` / `list()`
 *   - `api.tutorials.start(id)` → Promise<TutorialResult>
 *   - `api.tutorials.stop()` / `skip()`
 *   - `api.tutorials.completed(id)` / `markCompleted(id)` / `reset(id?)`
 *   - `api.tutorials.emit(name)` — fires a tutorial event (advance
 *      kind=event)
 *   - `api.tutorials.subscribe(listener)` — for the overlay component
 *   - `api.tutorials.getState()` — current `RuntimeState`
 *
 * The runtime is a single module-level singleton. The host editor
 * mounts a `<TutorialOverlayHost/>` once near `<App/>` that subscribes
 * via `subscribe()` and renders the actual `<TutorialOverlay/>` portal
 * when state is `active`.
 *
 * Completion persistence per TUTORIALS.md §5.4:
 *   - The shared key `cardboard.tutorials.completed` stores a JSON
 *     map of `{ <slug>: "completed" | "skipped" }`. This is the key
 *     the T1 acceptance criteria call out directly. The per-slug
 *     `cardboard:tutorial:<slug>:*` keys from §5.4 are reserved for
 *     T2's settings-tab integration.
 */

import type {
  AdvanceCondition,
  RuntimeState,
  TutorialDef,
  TutorialResult,
  TutorialStep,
} from "./types";

const COMPLETION_LS_KEY = "cardboard.tutorials.completed";

type CompletionMap = Record<string, "completed" | "skipped">;

function readCompletionMap(): CompletionMap {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(COMPLETION_LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") return parsed as CompletionMap;
    return {};
  } catch {
    return {};
  }
}

function writeCompletionMap(map: CompletionMap): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(COMPLETION_LS_KEY, JSON.stringify(map));
  } catch {
    // LS quota / disabled — silent failure is correct here, the
    // tutorial still functions in-session.
  }
}

// ---------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------

const registry = new Map<string, TutorialDef>();

function validate(def: TutorialDef): string | null {
  if (typeof def !== "object" || def === null) return "not an object";
  if (typeof def.id !== "string" || def.id.length === 0) return "missing id";
  if (typeof def.title !== "string") return "missing title";
  if (!Array.isArray(def.steps) || def.steps.length === 0) {
    return "steps must be a non-empty array";
  }
  if (def.steps.length > 30) return "steps array too long (>30)";
  if (def.$schema && def.$schema !== "tutorial/1") {
    return `unknown $schema ${def.$schema}`;
  }
  for (let i = 0; i < def.steps.length; i++) {
    const step = def.steps[i] as TutorialStep;
    if (typeof step !== "object" || step === null) {
      return `step ${i}: not an object`;
    }
    if (step.target !== null && typeof step.target !== "string") {
      return `step ${i}: target must be string|null`;
    }
    if (typeof step.hint !== "string") {
      return `step ${i}: hint must be string`;
    }
    const adv = step.advance;
    if (!adv || typeof adv !== "object") {
      return `step ${i}: missing advance`;
    }
    if (!["click", "key", "event", "timer", "next"].includes(adv.kind)) {
      return `step ${i}: unknown advance.kind ${adv.kind}`;
    }
  }
  return null;
}

export function registerTutorial(def: TutorialDef): boolean {
  const err = validate(def);
  if (err) {
    console.error(`[tutorials] register failed: ${err}`, def);
    return false;
  }
  if (registry.has(def.id)) {
    console.warn(
      `[tutorials] '${def.id}' is being overridden by a later registration`,
    );
  }
  registry.set(def.id, def);
  return true;
}

/**
 * Remove a tutorial from the registry. Used by the editor pack loader's
 * pack-disable path (T2) so toggling a pack off via the Extensions tab
 * rips its `manifest.tutorials[]` contributions out of the runtime
 * registry without a reload. Safe to call when the id is not present
 * (no-op). If the tutorial being unregistered is currently active,
 * the active session is stopped first so the overlay doesn't render
 * stale step content.
 */
export function unregisterTutorial(id: string): boolean {
  if (!registry.has(id)) return false;
  if (session && session.tutorial.id === id) {
    stopTutorial();
  }
  registry.delete(id);
  return true;
}

export function hasTutorial(id: string): boolean {
  return registry.has(id);
}

export function getTutorial(id: string): TutorialDef | null {
  return registry.get(id) ?? null;
}

export function listTutorials(): TutorialDef[] {
  return Array.from(registry.values()).sort((a, b) =>
    a.id.localeCompare(b.id),
  );
}

// ---------------------------------------------------------------------
// State machine + pub/sub
// ---------------------------------------------------------------------

let state: RuntimeState = { kind: "idle" };
const listeners = new Set<(s: RuntimeState) => void>();

function emit(): void {
  for (const l of listeners) {
    try {
      l(state);
    } catch (err) {
      console.error("[tutorials] listener error", err);
    }
  }
}

export function subscribe(listener: (s: RuntimeState) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getRuntimeState(): RuntimeState {
  return state;
}

// ---------------------------------------------------------------------
// Active tutorial driver
// ---------------------------------------------------------------------

interface ActiveSession {
  tutorial: TutorialDef;
  stepIndex: number;
  startedAt: number;
  resolve: (result: TutorialResult) => void;
  /** Cleanup callbacks for the current step's advance listeners.
   *  Cleared and rebuilt every time the step changes. */
  stepCleanups: Array<() => void>;
}

let session: ActiveSession | null = null;

/** Internal helper — clear current-step advance listeners. */
function clearStepListeners(): void {
  if (!session) return;
  for (const c of session.stepCleanups) {
    try {
      c();
    } catch (err) {
      console.error("[tutorials] cleanup error", err);
    }
  }
  session.stepCleanups = [];
}

/**
 * Wire up the advance condition for the active step. The runtime
 * attaches `document.body` capture-phase listeners (for click + key)
 * or schedules a timer (for `timer`); the `event` kind is driven by
 * `emit()` below; `next` is driven by the speech bubble's Next button
 * (which calls `advanceStep()` directly).
 */
function wireAdvance(condition: AdvanceCondition, step: TutorialStep): void {
  if (!session) return;

  if (condition.kind === "click") {
    const selector = condition.value ?? step.target;
    if (!selector) {
      console.warn("[tutorials] click advance with no selector");
      return;
    }
    const handler = (ev: MouseEvent): void => {
      const target = ev.target;
      if (!(target instanceof Element)) return;
      const match = target.closest(resolveSelector(selector));
      if (match) advanceStep();
    };
    document.body.addEventListener("click", handler, { capture: true });
    session.stepCleanups.push(() => {
      document.body.removeEventListener("click", handler, { capture: true });
    });
    return;
  }

  if (condition.kind === "key") {
    const combo = condition.value ?? "";
    const handler = (ev: KeyboardEvent): void => {
      if (matchCombo(ev, combo)) advanceStep();
    };
    window.addEventListener("keydown", handler, { capture: true });
    session.stepCleanups.push(() => {
      window.removeEventListener("keydown", handler, { capture: true });
    });
    return;
  }

  if (condition.kind === "event") {
    const name = condition.value ?? "";
    if (!name) {
      console.warn("[tutorials] event advance with no name");
      return;
    }
    pendingEventAdvance = name;
    session.stepCleanups.push(() => {
      if (pendingEventAdvance === name) pendingEventAdvance = null;
    });
    return;
  }

  if (condition.kind === "timer") {
    const ms = Math.max(0, Math.min(10_000, condition.delayMs ?? 1000));
    const timeoutId = window.setTimeout(() => advanceStep(), ms);
    session.stepCleanups.push(() => window.clearTimeout(timeoutId));
    return;
  }

  // `kind === "next"` — no auto-advance listener; the bubble's Next
  // button calls advanceStep() directly via the runtime API.
}

let pendingEventAdvance: string | null = null;

export function emitTutorialEvent(name: string): void {
  if (!session) return;
  if (pendingEventAdvance === name) {
    pendingEventAdvance = null;
    advanceStep();
  }
}

/**
 * Resolve a `target` string. If the string looks like a CSS selector
 * (contains any of `[ . # > : *` or whitespace), use it as-is; else
 * treat it as a registered tutorial-id and translate to
 * `[data-tutorial-id="<value>"]`.
 */
export function resolveSelector(raw: string): string {
  if (/[\[\].#>:* ]/.test(raw)) return raw;
  return `[data-tutorial-id="${cssEscape(raw)}"]`;
}

function cssEscape(s: string): string {
  return s.replace(/(["\\])/g, "\\$1");
}

/**
 * Internal hotkey-combo matcher. Supports `Cmd-`, `Ctrl-`, `Shift-`,
 * `Alt-` modifiers (case-insensitive) and a single key suffix. Mirrors
 * the runtime's R3 hotkey-string format described in §3.3.2.
 */
function matchCombo(ev: KeyboardEvent, combo: string): boolean {
  if (!combo) return false;
  const parts = combo.split("-").map((p) => p.trim());
  const key = parts[parts.length - 1]?.toLowerCase() ?? "";
  const mods = new Set(
    parts.slice(0, -1).map((m) => m.toLowerCase()),
  );
  const isMac =
    typeof navigator !== "undefined" && /Mac/i.test(navigator.platform ?? "");
  const wantCmd = mods.has("cmd") || mods.has("meta");
  const wantCtrl = mods.has("ctrl");
  // Cmd on mac → metaKey; Cmd off-mac → ctrlKey.
  const expectedMeta = wantCmd && isMac;
  const expectedCtrl = wantCtrl || (wantCmd && !isMac);
  const wantShift = mods.has("shift");
  const wantAlt = mods.has("alt");
  if (ev.metaKey !== expectedMeta) return false;
  if (ev.ctrlKey !== expectedCtrl) return false;
  if (ev.shiftKey !== wantShift) return false;
  if (ev.altKey !== wantAlt) return false;
  const evKey = (ev.key ?? "").toLowerCase();
  // Normalise " " → "space", "escape" stays "escape" etc.
  const normEvKey = evKey === " " ? "space" : evKey;
  return normEvKey === key;
}

// ---------------------------------------------------------------------
// Step machinery
// ---------------------------------------------------------------------

function publishActive(): void {
  if (!session) {
    state = { kind: "idle" };
  } else {
    state = {
      kind: "active",
      tutorial: session.tutorial,
      stepIndex: session.stepIndex,
      startedAt: session.startedAt,
    };
  }
  emit();
}

function enterStep(): void {
  if (!session) return;
  const step = session.tutorial.steps[session.stepIndex];
  if (!step) return;
  publishActive();
  wireAdvance(step.advance, step);
}

export function advanceStep(): void {
  if (!session) return;
  clearStepListeners();
  const nextIndex = session.stepIndex + 1;
  if (nextIndex >= session.tutorial.steps.length) {
    finishSession("completed");
    return;
  }
  session.stepIndex = nextIndex;
  enterStep();
}

function finishSession(status: TutorialResult["status"]): void {
  if (!session) return;
  clearStepListeners();
  const result: TutorialResult = {
    id: session.tutorial.id,
    status,
    durationMs: Date.now() - session.startedAt,
    stepReached: session.stepIndex,
  };
  if (status === "completed") {
    const map = readCompletionMap();
    map[session.tutorial.id] = "completed";
    writeCompletionMap(map);
  } else if (status === "skipped") {
    const map = readCompletionMap();
    map[session.tutorial.id] = "skipped";
    writeCompletionMap(map);
  }
  const resolve = session.resolve;
  session = null;
  publishActive();
  resolve(result);
}

// ---------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------

export function startTutorial(id: string): Promise<TutorialResult> {
  const def = registry.get(id);
  if (!def) {
    return Promise.resolve({
      id,
      status: "stopped",
      durationMs: 0,
      stepReached: 0,
    });
  }
  // Dismiss any in-flight tutorial first.
  if (session) {
    const prev = session;
    clearStepListeners();
    session = null;
    prev.resolve({
      id: prev.tutorial.id,
      status: "stopped",
      durationMs: Date.now() - prev.startedAt,
      stepReached: prev.stepIndex,
    });
  }
  return new Promise<TutorialResult>((resolve) => {
    session = {
      tutorial: def,
      stepIndex: 0,
      startedAt: Date.now(),
      resolve,
      stepCleanups: [],
    };
    enterStep();
  });
}

export function stopTutorial(): void {
  if (session) finishSession("stopped");
}

export function skipTutorial(): void {
  if (session) finishSession("skipped");
}

export function isCompleted(id: string): boolean {
  return readCompletionMap()[id] !== undefined;
}

export function markCompleted(id: string): void {
  const map = readCompletionMap();
  map[id] = "completed";
  writeCompletionMap(map);
}

export function resetTutorial(id?: string): void {
  if (!id) {
    writeCompletionMap({});
    return;
  }
  const map = readCompletionMap();
  delete map[id];
  writeCompletionMap(map);
}

/**
 * The public `api.tutorials` surface — exported as a single frozen
 * object so `globalThis.__cardboard_editor_shell.tutorials` is shape-
 * stable across HMR reloads.
 */
export const tutorialsApi = Object.freeze({
  has: hasTutorial,
  get: getTutorial,
  list: listTutorials,
  start: startTutorial,
  stop: stopTutorial,
  skip: skipTutorial,
  completed: isCompleted,
  markCompleted,
  reset: resetTutorial,
  emit: emitTutorialEvent,
  advance: advanceStep,
  subscribe,
  getState: getRuntimeState,
  _register: registerTutorial,
  _unregister: unregisterTutorial,
  _resolveSelector: resolveSelector,
  /** LS key for completion — exposed for tests + Settings tab. */
  _completionKey: COMPLETION_LS_KEY,
});

export type TutorialsApi = typeof tutorialsApi;
