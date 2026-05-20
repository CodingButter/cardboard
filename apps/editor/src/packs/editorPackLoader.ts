/**
 * Editor pack loader — Phase 1 (the dogfooding proof point).
 *
 * The editor app loads ONE editor-scope pack at startup:
 * `cardboard-editor-pack-demo`. The pack ships a `manifest.json`
 * declaring `scope: ["editor"]` + a list of `editorPanels[]` JSON
 * specs. The loader fetches each spec, wraps it in a
 * `<PanelRenderer spec={…}>`-rendered `DockPanelDef`, and returns the
 * resulting list so callers can merge those defs into their panel
 * registry.
 *
 * Phase 1 simplification: the pack is fetched over HTTP from a static
 * route the editor dev server exposes at
 * `/_packs/cardboard-editor-pack-demo/` (see `apps/editor/server.ts`).
 * It is NOT yet a real `.apg` unzip — there's no JSZip parse, no
 * checksum, no chain resolution. The loader is hardcoded to the one
 * demo pack id. The next phase (Phase 2 — Extensions tab + .apg
 * format) replaces this with the real `loadPackChain` + JSZip flow
 * used by the runtime engine's pack loader.
 *
 * The visible behavior is identical to a real .apg load: the editor
 * fetches an external manifest, walks the editor-panel list, and
 * mounts each panel into the dock-add modal. Swapping the fetch path
 * for a JSZip + chain resolver later is a localized refactor — no
 * caller needs to change. See `docs/plans/EDITOR_ENGINE.md` §8.
 *
 * Integration point: `MapView.tsx` (the Scene workspace) mounts a
 * hook (`useEditorPackPanels`) that calls `loadEditorPacks()` once
 * and merges the result into its dock panel registry. We deliberately
 * keep this Scene-scoped today — other workspaces (Image Lab, UI
 * Builder, …) will adopt the same hook when they grow editor-pack
 * contributions of their own.
 */

import React from "react";
import { FileJson } from "lucide-react";
import type { DockPanelDef } from "../components/dock/DockShell";
import { PanelRenderer } from "../panel-renderer/PanelRenderer";
import type { PanelSpec } from "../panel-renderer/types";
import type { PackManifest } from "@two_5_d/engine";

/** Hard-coded list of editor-pack ids the editor loads at startup.
 *  Phase 1 ships exactly one — the demo pack — to prove the loader
 *  works end-to-end. Phase 2 (Extensions tab) replaces this with a
 *  user-configurable list persisted in IDB / localStorage. */
const EDITOR_PACK_IDS: ReadonlyArray<string> = [
  "cardboard-editor-pack-demo",
];

/** Base path the editor dev server serves editor packs from. Mirrors
 *  the engine's `/packs/<file>.apg` convention but unpacked — the
 *  loader fetches individual JSON files rather than a single zip. */
const EDITOR_PACKS_BASE = "/_packs";

/**
 * Build a DockPanelDef from a loaded PanelSpec. The component is a
 * thin wrapper around `<PanelRenderer spec={…} />` — same trick the
 * (now-deleted) `JsonDemoPanel.tsx` used, but instantiated dynamically
 * per spec rather than baked into a TSX file.
 *
 * Memoisation: the wrapper component is created ONCE per spec and
 * cached on the def. dockview keys panels by their component-id
 * string so re-creating the wrapper on every render would force
 * mounts; the cache keeps identity stable for the lifetime of the
 * loader run.
 */
function buildDockPanelDef(spec: PanelSpec, packId: string): DockPanelDef {
  // Phase 1: every JSON-loaded panel renders through PanelRenderer.
  // Phase 2 may allow packs to register component-typed panels
  // alongside spec-typed ones; for now we only support the
  // declarative path.
  const Panel: React.FunctionComponent = () => {
    return React.createElement(PanelRenderer, { spec });
  };
  Panel.displayName = `EditorPackPanel(${packId}/${spec.id})`;
  return {
    id: spec.id,
    title: spec.title,
    category: spec.category,
    component: Panel,
    // TODO Phase 2 — let pack authors ship custom icon refs (lucide
    // name + colour). Until then every editor-pack-loaded panel
    // gets the FileJson icon so users can tell it apart from
    // hand-written TSX panels in the DocksModal.
    icon: React.createElement(FileJson, { size: 12 }),
  };
}

/** Fetch + JSON-parse a file from the editor-pack static route. Returns
 *  `null` when the file is missing or fails to parse — caller logs +
 *  skips so a broken pack file doesn't crash editor boot. */
async function fetchPackJson<T>(
  packId: string,
  relativePath: string,
): Promise<T | null> {
  const url = `${EDITOR_PACKS_BASE}/${packId}/${relativePath}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(
        `[editorPackLoader] ${url} → HTTP ${res.status}; skipping`,
      );
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.warn(
      `[editorPackLoader] ${url} → fetch/parse failed:`,
      err,
    );
    return null;
  }
}

/**
 * Load every editor pack the editor knows about and collect their
 * contributed `DockPanelDef`s. Designed to be called ONCE at editor
 * startup; subsequent calls re-fetch + re-build (idempotent — there's
 * no global side effect outside of the returned list).
 *
 * Errors during load (404, parse fail, missing scope, invalid spec)
 * are logged to the console and the offending file/pack is skipped.
 * The editor boots regardless — the editor shell does NOT depend on
 * any editor pack to function.
 */
export async function loadEditorPacks(): Promise<DockPanelDef[]> {
  const defs: DockPanelDef[] = [];
  for (const packId of EDITOR_PACK_IDS) {
    const manifest = await fetchPackJson<PackManifest>(
      packId,
      "manifest.json",
    );
    if (!manifest) {
      // fetchPackJson already logged the reason.
      continue;
    }
    // Guard: this pack MUST declare editor scope. A game-scope-only
    // pack accidentally placed under `/_packs/` should be ignored,
    // not silently treated as editor content.
    const scope = manifest.scope ?? ["game"];
    if (!scope.includes("editor")) {
      console.warn(
        `[editorPackLoader] pack ${packId} does not declare scope: ["editor"]; skipping`,
      );
      continue;
    }
    const panelPaths = manifest.editorPanels ?? [];
    if (panelPaths.length === 0) {
      // Editor-scope pack with no panel contributions — not an error,
      // but worth a debug log so authors notice an empty manifest.
      console.debug(
        `[editorPackLoader] pack ${packId} has no editorPanels[]; nothing to register`,
      );
      continue;
    }
    for (const panelPath of panelPaths) {
      const spec = await fetchPackJson<PanelSpec>(packId, panelPath);
      if (!spec) continue;
      if (!spec.id || !spec.title || !spec.category || !spec.root) {
        console.warn(
          `[editorPackLoader] ${packId}/${panelPath} is not a valid PanelSpec` +
            ` (missing id/title/category/root); skipping`,
        );
        continue;
      }
      defs.push(buildDockPanelDef(spec, packId));
    }
  }
  return defs;
}

/**
 * React hook: kick off `loadEditorPacks()` once on mount and return
 * the resolved DockPanelDef list. Returns an empty array until the
 * load completes, then re-renders with the loaded defs. Callers
 * merge this list into their own panel registry via `React.useMemo`.
 *
 * Errors are swallowed (the loader already logs); the hook resolves
 * to `[]` if every pack failed.
 */
export function useEditorPackPanels(): DockPanelDef[] {
  const [defs, setDefs] = React.useState<DockPanelDef[]>([]);
  React.useEffect(() => {
    let cancelled = false;
    void loadEditorPacks().then((loaded) => {
      if (cancelled) return;
      setDefs(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return defs;
}
