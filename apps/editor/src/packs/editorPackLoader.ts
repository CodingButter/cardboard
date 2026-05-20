/**
 * Editor pack loader — Phase 1b (real `.apg` unzip).
 *
 * The editor app loads ONE editor-scope pack at startup:
 * `cardboard-editor-pack-demo`. The pack ships a `manifest.json`
 * declaring `scope: ["editor"]` + a list of `editorPanels[]` JSON
 * specs. The loader fetches the `.apg`, decodes it via
 * `ZipAssetPack.loadFromBytes` (same JSZip flow the runtime engine's
 * pack loader uses), walks the manifest's `editorPanels[]`, and
 * returns a `DockPanelDef[]` so callers can merge those defs into
 * their panel registry.
 *
 * Phase 1a (the previous incarnation) fetched `manifest.json` + each
 * panel spec individually from a `/_packs/<pack-id>/<rel>` static
 * route. That route is gone; the loader now performs a single
 * `fetch("/packs/<pack-id>.apg")` + JSZip decode + in-memory reads.
 *
 * The public surface (`loadEditorPacks`, `useEditorPackPanels`) is
 * unchanged so MapView / DockShell / etc. don't have to know which
 * load mechanism is in use. Phase 2 (Extensions tab) replaces the
 * hardcoded `EDITOR_PACK_IDS` list with a user-configurable set
 * persisted in IDB; the loader internals stay the same.
 *
 * See `docs/plans/EDITOR_ENGINE.md` §8.
 */

import React from "react";
import { FileJson } from "lucide-react";
import type { DockPanelDef } from "../components/dock/DockShell";
import { PanelRenderer } from "../panel-renderer/PanelRenderer";
import type { PanelSpec } from "../panel-renderer/types";
import { ZipAssetPack, type PackManifest } from "@two_5_d/engine";

/** Hard-coded list of editor-pack ids the editor loads at startup.
 *  Phase 1 ships exactly one — the demo pack — to prove the loader
 *  works end-to-end. Phase 2 (Extensions tab) replaces this with a
 *  user-configurable list persisted in IDB / localStorage. */
const EDITOR_PACK_IDS: ReadonlyArray<string> = [
  "cardboard-editor-pack-demo",
];

/** Base path the editor dev server serves editor packs from. Each
 *  id resolves to `<EDITOR_PACKS_BASE>/<id>.apg`, served by the
 *  editor's `Bun.serve` (see `apps/editor/server.ts`). The same path
 *  shape will work in a production deploy where the .apg sits in
 *  `apps/editor/public/packs/`. */
const EDITOR_PACKS_BASE = "/packs";

/**
 * Build a DockPanelDef from a loaded PanelSpec. The component is a
 * thin wrapper around `<PanelRenderer spec={…} />` — same trick the
 * (now-deleted) `JsonDemoPanel.tsx` used, but instantiated dynamically
 * per spec rather than baked into a TSX file.
 *
 * Memoisation: the wrapper component is created ONCE per spec — react
 * keys panels by component identity, so re-creating the wrapper on
 * every render would force mounts; building it once keeps identity
 * stable for the lifetime of the loader run.
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

/**
 * Fetch + decode one editor pack's `.apg` and translate its
 * `editorPanels[]` list into a `DockPanelDef[]`. Returns an empty
 * list and logs a warning when the pack 404s, fails to decode, or
 * isn't scoped to the editor.
 */
async function loadOneEditorPack(packId: string): Promise<DockPanelDef[]> {
  const url = `${EDITOR_PACKS_BASE}/${packId}.apg`;
  let pack: ZipAssetPack;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(
        `[editorPackLoader] ${url} → HTTP ${res.status}; skipping`,
      );
      return [];
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    pack = await ZipAssetPack.loadFromBytes(bytes, url);
  } catch (err) {
    console.warn(
      `[editorPackLoader] ${url} → fetch/decode failed:`,
      err,
    );
    return [];
  }

  const manifest = pack.manifest as PackManifest;
  // Guard: this pack MUST declare editor scope. A game-scope-only
  // pack accidentally placed under `/packs/` should be ignored, not
  // silently treated as editor content.
  const scope = manifest.scope ?? ["game"];
  if (!scope.includes("editor")) {
    console.warn(
      `[editorPackLoader] pack ${packId} does not declare scope: ["editor"]; skipping`,
    );
    return [];
  }
  const panelPaths = manifest.editorPanels ?? [];
  if (panelPaths.length === 0) {
    // Editor-scope pack with no panel contributions — not an error,
    // but worth a debug log so authors notice an empty manifest.
    console.debug(
      `[editorPackLoader] pack ${packId} has no editorPanels[]; nothing to register`,
    );
    return [];
  }

  const defs: DockPanelDef[] = [];
  for (const panelPath of panelPaths) {
    let spec: PanelSpec;
    try {
      // `textBody` reads the in-memory `Uint8Array` from the decoded
      // zip — no second network round-trip. Missing files throw, so
      // the per-panel try/catch contains them.
      const text = await pack.textBody(panelPath);
      spec = JSON.parse(text) as PanelSpec;
    } catch (err) {
      console.warn(
        `[editorPackLoader] ${packId}/${panelPath} → read/parse failed:`,
        err,
      );
      continue;
    }
    if (!spec.id || !spec.title || !spec.category || !spec.root) {
      console.warn(
        `[editorPackLoader] ${packId}/${panelPath} is not a valid PanelSpec` +
          ` (missing id/title/category/root); skipping`,
      );
      continue;
    }
    defs.push(buildDockPanelDef(spec, packId));
  }
  return defs;
}

/**
 * Load every editor pack the editor knows about and collect their
 * contributed `DockPanelDef`s. Designed to be called ONCE at editor
 * startup; subsequent calls re-fetch + re-decode (idempotent — there's
 * no global side effect outside of the returned list).
 *
 * Errors during load (404, decode fail, missing scope, invalid spec)
 * are logged to the console and the offending file/pack is skipped.
 * The editor boots regardless — the editor shell does NOT depend on
 * any editor pack to function.
 */
export async function loadEditorPacks(): Promise<DockPanelDef[]> {
  const defs: DockPanelDef[] = [];
  for (const packId of EDITOR_PACK_IDS) {
    const packDefs = await loadOneEditorPack(packId);
    defs.push(...packDefs);
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
