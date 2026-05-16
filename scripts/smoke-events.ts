#!/usr/bin/env bun
/**
 * Smoke test for Phase Ev1 of `docs/plans/EVENTS.md`.
 *
 * Constructs an `EventsRegistry` standalone (no full Game needed) and
 * walks every property the Ev1 surface promises:
 *
 *   1. Subscribe + emit → handler ran with the exact payload.
 *   2. Multiple handlers on one topic → registration order preserved.
 *   3. `once` → emit twice, handler runs once.
 *   4. `off(subscription)` → cancels future emits.
 *   5. `off(name, handler)` → exact-ref form works.
 *   6. Handler throw → next handler still runs, emit returns cleanly.
 *   7. No-subscriber fast path → 100k emits complete instantly.
 *   8. Pack-script tagging → disposeScript drops only its handlers.
 *   9. disposeAll → registry empties.
 *  10. Re-entrancy: a handler emits the same topic; once-handler
 *      doesn't re-trigger itself.
 *
 * Runs entirely against the engine's `EventsRegistry` class — no DOM,
 * no Game, no World needed. Run with:
 *
 *   bun run scripts/smoke-events.ts
 *
 * Exits non-zero on any failed assertion.
 */

import { EventsRegistry } from "../packages/engine/src/ModAPI/EventsRegistry";

let failed = 0;
function assert(cond: unknown, msg: string): void {
  if (cond) {
    console.log(`  ✔ ${msg}`);
  } else {
    console.log(`  ✘ ${msg}`);
    failed++;
  }
}

console.log("\n=== EVENTS Ev1 smoke ===\n");

// 1. Subscribe + emit
{
  console.log("1. subscribe + emit");
  const r = new EventsRegistry();
  let captured: unknown = null;
  r.on<{ n: number }>("test:basic", (p) => {
    captured = p;
  });
  r.emit("test:basic", { n: 42 });
  assert(
    captured !== null && (captured as { n: number }).n === 42,
    "handler received payload {n:42}",
  );
}

// 2. Registration order preserved
{
  console.log("2. registration-order dispatch");
  const r = new EventsRegistry();
  const order: number[] = [];
  r.on("ordered", () => order.push(1));
  r.on("ordered", () => order.push(2));
  r.on("ordered", () => order.push(3));
  r.emit("ordered");
  assert(
    order.length === 3 && order[0] === 1 && order[1] === 2 && order[2] === 3,
    "handlers fired in registration order [1,2,3]",
  );
}

// 3. once — fires exactly once
{
  console.log("3. once");
  const r = new EventsRegistry();
  let count = 0;
  r.once("oneshot", () => count++);
  r.emit("oneshot");
  r.emit("oneshot");
  r.emit("oneshot");
  assert(count === 1, "once handler fired exactly 1× across 3 emits");
}

// 4. off(subscription) cancels future emits
{
  console.log("4. off(subscription)");
  const r = new EventsRegistry();
  let count = 0;
  const sub = r.on("cancel", () => count++);
  r.emit("cancel");
  sub.off();
  r.emit("cancel");
  r.emit("cancel");
  assert(count === 1, "after sub.off() handler doesn't fire");
  // Idempotent — calling off() twice is a no-op
  sub.off();
  r.emit("cancel");
  assert(count === 1, "sub.off() is idempotent");
}

// 5. off(name, handler) — DOM-ish form
{
  console.log("5. off(name, handler)");
  const r = new EventsRegistry();
  let count = 0;
  const h = (): void => {
    count++;
  };
  r.on("named-off", h);
  r.emit("named-off");
  r.off("named-off", h);
  r.emit("named-off");
  assert(count === 1, "off(name, handler) removes the handler");
}

// 6. Handler throw — next handler still runs
{
  console.log("6. throw isolation");
  const r = new EventsRegistry();
  let later = 0;
  // Swallow console.error during this test so the throw doesn't litter
  // test output (the spec says emit() logs and skips).
  const origErr = console.error;
  let loggedThrow = false;
  console.error = (..._args: unknown[]): void => {
    loggedThrow = true;
  };
  try {
    r.on("throwy", () => {
      throw new Error("kaboom");
    });
    r.on("throwy", () => {
      later++;
    });
    r.emit("throwy");
  } finally {
    console.error = origErr;
  }
  assert(later === 1, "later handler ran after earlier handler threw");
  assert(loggedThrow, "throw was logged via console.error");
}

// 7. No-subscriber fast path — 100k emits is instant
{
  console.log("7. no-subscriber fast path");
  const r = new EventsRegistry();
  const N = 100_000;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) {
    r.emit("frame:before", { deltaTime: 0.016, frameIndex: i });
  }
  const elapsed = performance.now() - t0;
  console.log(`    ${N} emits with 0 subscribers: ${elapsed.toFixed(2)} ms`);
  assert(elapsed < 200, `${N} no-sub emits under 200ms (got ${elapsed.toFixed(1)}ms)`);
  // Also verify the registry still reports zero subscriptions.
  assert(r.size() === 0, "registry remains empty after burst");
}

// 8. Pack-script tagging — disposeScript drops only its handlers
{
  console.log("8. disposeScript");
  const r = new EventsRegistry();
  let aFires = 0;
  let bFires = 0;
  let untaggedFires = 0;

  r.setActiveScript("scripts/a.js");
  r.on("topic", () => aFires++);
  r.setActiveScript("scripts/b.js");
  r.on("topic", () => bFires++);
  r.setActiveScript(null);
  r.on("topic", () => untaggedFires++);

  r.emit("topic");
  assert(aFires === 1 && bFires === 1 && untaggedFires === 1, "all 3 fired once");

  r.disposeScript("scripts/a.js");
  r.emit("topic");
  assert(
    aFires === 1 && bFires === 2 && untaggedFires === 2,
    "disposeScript(a) drops only A's handler",
  );

  r.disposeScript("scripts/b.js");
  r.emit("topic");
  assert(
    aFires === 1 && bFires === 2 && untaggedFires === 3,
    "disposeScript(b) drops only B's handler",
  );

  assert(r.size() === 1, "1 untagged subscription remains");
}

// 9. disposeAll — registry empties
{
  console.log("9. disposeAll");
  const r = new EventsRegistry();
  r.on("a", () => {});
  r.on("b", () => {});
  r.on("c", () => {});
  assert(r.size() === 3, "3 subscriptions before disposeAll");
  r.disposeAll();
  assert(r.size() === 0, "0 subscriptions after disposeAll");
  let fired = 0;
  r.on("a", () => fired++);
  r.emit("a");
  assert(fired === 1, "registry usable post-disposeAll");
}

// 10. Re-entrancy: once handler that re-emits doesn't re-fire itself
{
  console.log("10. once re-entrancy");
  const r = new EventsRegistry();
  let count = 0;
  r.once("loop", () => {
    count++;
    // Re-emit synchronously inside the once-handler. The once wrapper
    // removes itself BEFORE invoking, so this nested emit must NOT
    // re-trigger this same handler.
    r.emit("loop");
  });
  r.emit("loop");
  assert(count === 1, "once handler that re-emits didn't recurse");
}

// 11. Snapshot semantics: adding a handler mid-dispatch doesn't fire it now
{
  console.log("11. snapshot dispatch");
  const r = new EventsRegistry();
  let lateCount = 0;
  r.on("snap", () => {
    // Add a NEW subscription during this emit's dispatch — Snapshot
    // semantics: the new handler shouldn't fire as part of THIS emit,
    // only on the next one.
    r.on("snap", () => lateCount++);
  });
  r.emit("snap");
  assert(lateCount === 0, "late-added handler skipped during current emit");
  r.emit("snap");
  // Each emit invokes the original handler which keeps adding new
  // handlers; just confirm at least one fired this second emit.
  assert(lateCount >= 1, "late-added handler fires on next emit");
}

console.log("\n========================");
if (failed === 0) {
  console.log("✅ All Ev1 events smoke checks passed.");
  process.exit(0);
} else {
  console.log(`❌ ${failed} assertion(s) failed.`);
  process.exit(1);
}
