/**
 * Tutorial system T1 — runtime unit tests.
 *
 * Smoke-tests the registry + state machine + LS-persistence layers
 * without any DOM. The overlay component is integration-tested in the
 * browser (Playwright smoke verifies the spotlight + bubble actually
 * paint).
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  emitTutorialEvent,
  getRuntimeState,
  hasTutorial,
  isCompleted,
  listTutorials,
  markCompleted,
  registerTutorial,
  resetTutorial,
  resolveSelector,
  skipTutorial,
  startTutorial,
  stopTutorial,
  tutorialsApi,
} from "./runtime";
import type { TutorialDef } from "./types";

const DEMO: TutorialDef = {
  $schema: "tutorial/1",
  id: "test-runtime-demo",
  title: "Demo",
  description: "demo",
  steps: [
    { target: null, hint: "step 1", advance: { kind: "next" } },
    {
      target: "test-btn",
      hint: "step 2",
      advance: { kind: "event", value: "test.advance" },
    },
    { target: null, hint: "step 3", advance: { kind: "next" } },
  ],
};

// Bun test runs in a Node-ish environment without `localStorage` /
// `document`. Stub the bits we need so the runtime doesn't crash on
// import; tests that don't touch DOM stay deterministic.
beforeEach(() => {
  // Assign a minimal in-memory LS shim. The cast keeps TS happy in
  // environments where `globalThis.localStorage` is already typed.
  (globalThis as { localStorage: Storage }).localStorage = (() => {
    const store = new Map<string, string>();
    return {
      getItem: (k: string): string | null => store.get(k) ?? null,
      setItem: (k: string, v: string): void => {
        store.set(k, v);
      },
      removeItem: (k: string): void => {
        store.delete(k);
      },
      clear: (): void => store.clear(),
      key: (i: number): string | null => Array.from(store.keys())[i] ?? null,
      get length(): number {
        return store.size;
      },
    };
  })();
  resetTutorial();
});

afterEach(() => {
  stopTutorial();
});

describe("tutorial registry", () => {
  test("registers a valid tutorial", () => {
    expect(registerTutorial(DEMO)).toBe(true);
    expect(hasTutorial(DEMO.id)).toBe(true);
    expect(listTutorials().some((t) => t.id === DEMO.id)).toBe(true);
  });

  test("rejects a bad tutorial", () => {
    // Missing steps array.
    const bad = { id: "bad", title: "x" } as unknown as TutorialDef;
    expect(registerTutorial(bad)).toBe(false);
    expect(hasTutorial("bad")).toBe(false);
  });

  test("rejects unknown $schema", () => {
    const bad: TutorialDef = {
      ...DEMO,
      id: "bad-schema",
      $schema: "tutorial/9999",
    };
    expect(registerTutorial(bad)).toBe(false);
  });
});

describe("resolveSelector", () => {
  test("treats a bare id as a data-tutorial-id lookup", () => {
    expect(resolveSelector("tools-palette")).toBe(
      '[data-tutorial-id="tools-palette"]',
    );
  });

  test("passes a real selector through verbatim", () => {
    expect(resolveSelector("[data-panel='map-canvas']")).toBe(
      "[data-panel='map-canvas']",
    );
    expect(resolveSelector(".some-class")).toBe(".some-class");
  });
});

describe("state machine", () => {
  test("starts idle", () => {
    expect(getRuntimeState().kind).toBe("idle");
  });

  test("walks all steps via next + event advances", async () => {
    registerTutorial(DEMO);
    const promise = startTutorial(DEMO.id);
    expect(getRuntimeState().kind).toBe("active");
    expect((getRuntimeState() as { stepIndex: number }).stepIndex).toBe(0);

    // step 0 — `next`, advance manually
    tutorialsApi.advance();
    expect((getRuntimeState() as { stepIndex: number }).stepIndex).toBe(1);

    // step 1 — `event`, emit the matching event
    emitTutorialEvent("test.advance");
    expect((getRuntimeState() as { stepIndex: number }).stepIndex).toBe(2);

    // step 2 — last step, `next` finishes
    tutorialsApi.advance();
    const result = await promise;
    expect(result.status).toBe("completed");
    expect(result.stepReached).toBe(2);
    expect(getRuntimeState().kind).toBe("idle");
    expect(isCompleted(DEMO.id)).toBe(true);
  });

  test("skip dismisses and records skipped", async () => {
    registerTutorial(DEMO);
    const promise = startTutorial(DEMO.id);
    skipTutorial();
    const result = await promise;
    expect(result.status).toBe("skipped");
    expect(getRuntimeState().kind).toBe("idle");
    expect(isCompleted(DEMO.id)).toBe(true); // skip counts as recorded
  });

  test("stop dismisses without recording completion", async () => {
    registerTutorial(DEMO);
    const promise = startTutorial(DEMO.id);
    stopTutorial();
    const result = await promise;
    expect(result.status).toBe("stopped");
    expect(isCompleted(DEMO.id)).toBe(false);
  });

  test("starting an unknown slug resolves immediately", async () => {
    const result = await startTutorial("does-not-exist");
    expect(result.status).toBe("stopped");
    expect(getRuntimeState().kind).toBe("idle");
  });

  test("starting a second tutorial cancels the first", async () => {
    registerTutorial(DEMO);
    registerTutorial({ ...DEMO, id: "test-runtime-demo-2" });
    const first = startTutorial(DEMO.id);
    const second = startTutorial("test-runtime-demo-2");
    const r1 = await first;
    expect(r1.status).toBe("stopped");
    stopTutorial();
    await second;
  });
});

describe("completion persistence", () => {
  test("markCompleted persists across reads", () => {
    registerTutorial(DEMO);
    expect(isCompleted(DEMO.id)).toBe(false);
    markCompleted(DEMO.id);
    expect(isCompleted(DEMO.id)).toBe(true);
  });

  test("reset(slug) clears a specific slug", () => {
    markCompleted("a");
    markCompleted("b");
    resetTutorial("a");
    expect(isCompleted("a")).toBe(false);
    expect(isCompleted("b")).toBe(true);
  });

  test("reset() with no arg wipes all", () => {
    markCompleted("a");
    markCompleted("b");
    resetTutorial();
    expect(isCompleted("a")).toBe(false);
    expect(isCompleted("b")).toBe(false);
  });
});
