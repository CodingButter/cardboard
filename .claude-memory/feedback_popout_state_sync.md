---
name: feedback-popout-state-sync
description: "All cross-panel state (selection, active tool, brush, layers, history, etc.) MUST work perfectly even when a panel is popped out into its own browser window. Pop-outs have separate JS contexts and separate Zustand instances — design the wiring layer for cross-window communication from day one."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 7c1d9c99-8bc0-445e-84a2-2fadbbb70b5c
---

User direction: "the wiring stage is going to be where we really nail the popout window communication flow. everything needs to be able to work perfectly even if the dock is popped out."

**The constraint:**

dockview supports panel pop-out via `window.open` — clicking the popout button moves a panel into its own browser window. The popout has its own DOM, own React tree, own JavaScript context. Vanilla module-level singletons (like Zustand stores) get a SEPARATE instance per window. The popout shares localStorage with the orchestrator window (same origin).

A naive Zustand store will diverge: the orchestrator window has its `useToolStore`, the popout has ITS OWN `useToolStore`, and a tool change in one won't propagate to the other.

## Implementation pattern

Two communication channels:

### 1. Persistent state — localStorage + `storage` events

For state that should survive reloads (active tool, brush size, layer visibility, scene cells, notes text):

- Zustand stores wrap with `zustand/middleware/persist`, writing to localStorage under a scoped key.
- A `useEffect` in each store's hook attaches a `window.addEventListener("storage", ...)` listener. When the storage event fires (from another window writing to the same key), it re-hydrates the store from the new value.

### 2. Ephemeral state — BroadcastChannel API

For state that doesn't need persistence but must propagate between windows (cursor coords as user hovers MapCanvas, drag preview during paint, ephemeral hover highlights):

- Use the `BroadcastChannel` API: `const ch = new BroadcastChannel("cardboard:scene")`.
- Pair with a Zustand store that listens + writes to local state on receipt.

## Architecture guidance

- **One store per concern** — `useSelectionStore`, `useToolStore`, `useBrushStore`, `useLayerStore`, `useSceneStore`, `useHistoryStore`. Each persists its relevant slice + subscribes to cross-window sync.
- **Avoid storing references** — only serializable data (numbers, strings, plain objects, arrays). React component refs, DOM nodes, Three.js objects can't cross window boundaries.
- **Identify hot paths** — cursor-tracking on MapCanvas fires at 60Hz; throttle / debounce ephemeral broadcasts to ~30Hz, or only emit on cell-grid boundary crossings.

## Testing

When testing Wave 3 wiring, ALWAYS test the popout path:
1. Click the popout icon on a panel.
2. Make a state change in the popout.
3. Verify the change is reflected in the orchestrator window.
4. Reverse direction.
5. Reload both windows — verify state persists where it should.

## Implication for Wave 3

The first commits in Wave 3 are:
1. A `cross-window-sync` utility module (`apps/editor/src/state/sync.ts`) that wraps `persist` + `BroadcastChannel` into a single helper.
2. Build new stores on top of this utility.

**Do NOT build Wave 3 stores without the cross-window sync layer — retrofitting is harder than getting it right up front.**
