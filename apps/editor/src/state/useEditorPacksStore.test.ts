/**
 * useEditorPacksStore tests.
 *
 * Asserts initial state, the two actions (setEnabled, setMeta), and
 * the getEnabledEditorPackIds helper. The store uses `createSyncedStore`,
 * which wires up zustand's `persist` middleware against localStorage —
 * we reset state between tests via `setState({...})` so each case starts
 * from a known baseline.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  useEditorPacksStore,
  getEnabledEditorPackIds,
} from "./useEditorPacksStore";

const DEMO_ID = "cardboard-editor-pack-demo";

function freshState(): void {
  useEditorPacksStore.setState({
    packs: {
      [DEMO_ID]: {
        id: DEMO_ID,
        enabled: true,
        meta: null,
      },
    },
  });
}

beforeEach(freshState);
afterEach(freshState);

describe("useEditorPacksStore", () => {
  test("initial state ships the demo pack enabled with null meta", () => {
    const { packs } = useEditorPacksStore.getState();
    expect(Object.keys(packs)).toEqual([DEMO_ID]);
    const entry = packs[DEMO_ID];
    expect(entry).toBeDefined();
    expect(entry!.id).toBe(DEMO_ID);
    expect(entry!.enabled).toBe(true);
    expect(entry!.meta).toBeNull();
  });

  test("setEnabled flips the enabled flag", () => {
    const { setEnabled } = useEditorPacksStore.getState();
    setEnabled(DEMO_ID, false);
    expect(useEditorPacksStore.getState().packs[DEMO_ID]!.enabled).toBe(false);
    setEnabled(DEMO_ID, true);
    expect(useEditorPacksStore.getState().packs[DEMO_ID]!.enabled).toBe(true);
  });

  test("setEnabled is a no-op for unknown pack ids", () => {
    const before = useEditorPacksStore.getState().packs;
    useEditorPacksStore.getState().setEnabled("nonexistent-pack", false);
    const after = useEditorPacksStore.getState().packs;
    // Same identity is overkill (the setter clones on hit); compare
    // serialised shape instead.
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    expect(after["nonexistent-pack"]).toBeUndefined();
  });

  test("setMeta caches manifest-derived metadata on the entry", () => {
    const meta = { name: "Demo Pack", version: "0.0.1", panelCount: 1 };
    useEditorPacksStore.getState().setMeta(DEMO_ID, meta);
    const entry = useEditorPacksStore.getState().packs[DEMO_ID];
    expect(entry!.meta).toEqual(meta);
  });

  test("setMeta with null clears cached metadata", () => {
    useEditorPacksStore.getState().setMeta(DEMO_ID, {
      name: "Demo Pack",
      version: "0.0.1",
      panelCount: 1,
    });
    useEditorPacksStore.getState().setMeta(DEMO_ID, null);
    expect(useEditorPacksStore.getState().packs[DEMO_ID]!.meta).toBeNull();
  });

  test("getEnabledEditorPackIds returns only enabled entries", () => {
    // Start state: demo enabled, ids = [DEMO_ID].
    expect(getEnabledEditorPackIds()).toEqual([DEMO_ID]);

    // Disable demo → empty list.
    useEditorPacksStore.getState().setEnabled(DEMO_ID, false);
    expect(getEnabledEditorPackIds()).toEqual([]);

    // Add a second pack manually + enable both → ordered by insertion.
    useEditorPacksStore.setState((s) => ({
      packs: {
        ...s.packs,
        "another-pack": { id: "another-pack", enabled: true, meta: null },
      },
    }));
    useEditorPacksStore.getState().setEnabled(DEMO_ID, true);
    expect(getEnabledEditorPackIds()).toEqual([DEMO_ID, "another-pack"]);
  });
});
