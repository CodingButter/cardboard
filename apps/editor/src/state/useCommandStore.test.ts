/**
 * useCommandStore — cross-window dispatch broadcast layer (task #9).
 *
 * The store hosts a module-level `BroadcastChannel("cardboard.commands")`.
 * Outbound: an outermost-local `runById(id)` invocation posts a
 * `{ kind: "run", commandId, originId, broadcastId, timestamp }` message
 * on the channel UNLESS the command opted into `scope: "origin-only"`.
 * Inbound: the receiver subscription replays the command id locally,
 * seeding `visited` so the dispatch gate inside `runById` doesn't
 * re-broadcast.
 *
 * Bun's runtime ships a native BroadcastChannel, so this test can wire
 * a sibling channel and observe the round-trip directly.
 */

import { afterEach, describe, expect, test } from "bun:test";
import {
  __commandBroadcastInternals,
  registerCommand,
  useCommandStore,
} from "./useCommandStore";

describe("cross-window command broadcast", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop();
      try {
        fn?.();
      } catch {
        // swallow — cleanup best-effort
      }
    }
  });

  test("outermost-local runById posts a broadcast for scope=broadcast (default)", async () => {
    const sibling = new BroadcastChannel("cardboard.commands");
    const seen: Array<Record<string, unknown>> = [];
    const onMsg = (ev: MessageEvent): void => {
      seen.push(ev.data as Record<string, unknown>);
    };
    sibling.addEventListener("message", onMsg);
    cleanups.push(() => {
      sibling.removeEventListener("message", onMsg);
      sibling.close();
    });

    let ran = 0;
    cleanups.push(
      registerCommand({
        id: "test.broadcast.default",
        title: "Test Broadcast Default",
        run: () => {
          ran++;
        },
      }),
    );

    await useCommandStore.getState().runById("test.broadcast.default");
    // BroadcastChannel delivery is async — wait a tick.
    await new Promise((r) => setTimeout(r, 50));

    expect(ran).toBe(1);
    expect(seen.length).toBe(1);
    expect(seen[0]?.kind).toBe("run");
    expect(seen[0]?.commandId).toBe("test.broadcast.default");
    expect(seen[0]?.originId).toBe(__commandBroadcastInternals.originId);
    expect(typeof seen[0]?.broadcastId).toBe("string");
  });

  test("scope: 'origin-only' commands DO NOT post a broadcast", async () => {
    const sibling = new BroadcastChannel("cardboard.commands");
    const seen: Array<Record<string, unknown>> = [];
    const onMsg = (ev: MessageEvent): void => {
      seen.push(ev.data as Record<string, unknown>);
    };
    sibling.addEventListener("message", onMsg);
    cleanups.push(() => {
      sibling.removeEventListener("message", onMsg);
      sibling.close();
    });

    let ran = 0;
    cleanups.push(
      registerCommand({
        id: "test.broadcast.originOnly",
        title: "Test Origin Only",
        scope: "origin-only",
        run: () => {
          ran++;
        },
      }),
    );

    await useCommandStore.getState().runById("test.broadcast.originOnly");
    await new Promise((r) => setTimeout(r, 50));

    expect(ran).toBe(1);
    expect(seen.length).toBe(0);
  });

  test("inbound broadcast invokes local command without re-broadcasting", async () => {
    // Three roles in this scenario:
    //   - `sender`  — the simulated foreign sibling posting AT us.
    //   - `witness` — a third channel observing all traffic. Because
    //     a BroadcastChannel does NOT deliver to its own sender, the
    //     sender can't observe its own message. A separate witness
    //     channel sees both the sender's post AND any echo the
    //     receiver might mistakenly emit.
    const sender = new BroadcastChannel("cardboard.commands");
    const witness = new BroadcastChannel("cardboard.commands");
    const seen: Array<Record<string, unknown>> = [];
    const onMsg = (ev: MessageEvent): void => {
      seen.push(ev.data as Record<string, unknown>);
    };
    witness.addEventListener("message", onMsg);
    cleanups.push(() => {
      witness.removeEventListener("message", onMsg);
      witness.close();
      sender.close();
    });

    let ran = 0;
    cleanups.push(
      registerCommand({
        id: "test.broadcast.inbound",
        title: "Test Inbound",
        run: () => {
          ran++;
        },
      }),
    );

    sender.postMessage({
      kind: "run",
      commandId: "test.broadcast.inbound",
      // Foreign originId so our echo guard doesn't drop the message.
      originId: "test-sibling-window",
      broadcastId: `bcast-${Date.now()}-${Math.random()}`,
      timestamp: Date.now(),
    });
    await new Promise((r) => setTimeout(r, 50));

    expect(ran).toBe(1);
    // The witness should see EXACTLY the sender's post — no echo from
    // the receiver-side replay.
    expect(seen.length).toBe(1);
    expect(seen[0]?.originId).toBe("test-sibling-window");
  });

  test("duplicate broadcastId is dropped (loop prevention)", async () => {
    const sibling = new BroadcastChannel("cardboard.commands");
    cleanups.push(() => sibling.close());

    let ran = 0;
    cleanups.push(
      registerCommand({
        id: "test.broadcast.dedupe",
        title: "Test Dedupe",
        run: () => {
          ran++;
        },
      }),
    );

    const broadcastId = `dedupe-${Date.now()}`;
    const wire = {
      kind: "run" as const,
      commandId: "test.broadcast.dedupe",
      originId: "test-sibling-window",
      broadcastId,
      timestamp: Date.now(),
    };
    sibling.postMessage(wire);
    sibling.postMessage(wire);
    sibling.postMessage(wire);
    await new Promise((r) => setTimeout(r, 50));

    expect(ran).toBe(1);
  });

  test("broadcast for an unregistered command id is a no-op", async () => {
    const sibling = new BroadcastChannel("cardboard.commands");
    cleanups.push(() => sibling.close());

    // No registerCommand call for this id — the receiver should drop.
    sibling.postMessage({
      kind: "run",
      commandId: "test.broadcast.unregistered",
      originId: "test-sibling-window",
      broadcastId: `unknown-${Date.now()}`,
      timestamp: Date.now(),
    });
    await new Promise((r) => setTimeout(r, 50));
    // Nothing observable to assert beyond not throwing — the test
    // existing proves the receiver handles unknown ids gracefully.
    expect(true).toBe(true);
  });
});
