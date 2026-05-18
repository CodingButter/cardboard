import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PackManifest, PackRequiresEntry } from "@two_5_d/engine";
import { clearChainCache } from "@two_5_d/engine";
import { EditorProjectStore, type AssetMeta } from "../lib/EditorProjectStore";
import { Button, Input, Label, Textarea } from "../components/ui";
import { cn } from "../lib/cn";
import {
  addDependency,
  fetchAndHashPack,
  hostnameOf,
  listRequires,
  patchDependency,
  removeDependency,
  reorderDependency,
  toggleDependencyEnabled,
  truncateIntegrity,
  verifyIntegrity,
  type VerifyResult,
} from "../lib/dependencyManager";
import {
  detectConflicts,
  type Conflict,
  type ConflictReport,
} from "../lib/chainConflictDetector";
import { resolveDepChain } from "../lib/resolveDepChain";

/**
 * Project Settings modal — the occasional-configuration surface for
 * a pack. Per the iframe-pivot reorg, Map mode is now pure (grid
 * editor + scene list) and everything else (manifest metadata,
 * dependencies, export config, advanced flags) lives behind a ⚙
 * button on the project header.
 *
 * Tab structure mirrors the spec exactly:
 *   - Manifest      pack metadata (name, version, engine, ids, …)
 *   - Dependencies  manifest.requires[] with add/refresh/reorder/toggle
 *   - Export        placeholder for the build-modes UI (#192/E5)
 *   - Advanced      placeholder for future flags / store creds
 *
 * State model: each tab keeps its own draft (so a half-edited
 * Manifest field doesn't get saved when the user clicks "Save deps"
 * in the Dependencies tab). The modal owns no global "dirty" — each
 * tab flushes through `EditorProjectStore.saveManifest` and refreshes
 * the modal's local copy.
 */

export interface ProjectSettingsModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  /** Notify parent so the parent (ProjectView) refreshes asset list / scene picker. */
  onManifestChanged?: () => void;
  /**
   * Iframe ref to broadcast `{type:"reset"}` to when the user clicks
   * the bottom "Reload running game" button. The modal doesn't own
   * the iframe — the parent passes a getter so the broadcast targets
   * the right frame.
   */
  getIframe?: () => HTMLIFrameElement | null;
}

type Tab = "manifest" | "dependencies" | "export" | "advanced";

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: "manifest", label: "Manifest" },
  { id: "dependencies", label: "Dependencies" },
  { id: "export", label: "Export" },
  { id: "advanced", label: "Advanced" },
];

export function ProjectSettingsModal({
  open,
  onClose,
  projectId,
  onManifestChanged,
  getIframe,
}: ProjectSettingsModalProps) {
  const [tab, setTab] = useState<Tab>("manifest");
  const [manifest, setManifest] = useState<PackManifest | null>(null);
  const [assets, setAssets] = useState<AssetMeta[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [mf, as] = await Promise.all([
        EditorProjectStore.loadManifest(projectId),
        EditorProjectStore.listAssets(projectId),
      ]);
      setManifest(mf);
      setAssets(as);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [projectId]);

  useEffect(() => {
    if (!open) return;
    refresh();
  }, [open, refresh]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleReloadGame = () => {
    const iframe = getIframe?.();
    iframe?.contentWindow?.postMessage({ type: "reset" }, "*");
  };

  const handleManifestSaved = async (next: PackManifest) => {
    await EditorProjectStore.saveManifest(projectId, next);
    setManifest(next);
    onManifestChanged?.();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-[80vw] h-[80vh] max-w-[1400px] flex flex-col rounded-lg border border-zinc-800 bg-zinc-900 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <h2 className="text-base font-semibold tracking-tight">
            Project Settings
          </h2>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-100 text-xl leading-none"
            title="Close (Esc)"
          >
            ×
          </button>
        </header>

        {/* Tab strip */}
        <nav className="flex items-center gap-1 px-6 border-b border-zinc-800 bg-zinc-950/40">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "px-4 py-2 text-sm border-b-2 -mb-px transition-colors",
                tab === t.id
                  ? "border-amber-400 text-amber-300"
                  : "border-transparent text-zinc-400 hover:text-zinc-100",
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {/* Tab body */}
        <div className="flex-1 overflow-auto px-6 py-5">
          {error ? (
            <div className="mb-4 rounded-md border border-red-700 bg-red-900/30 px-4 py-2 text-sm text-red-200">
              {error}
              <button
                className="ml-2 underline underline-offset-2 hover:text-white"
                onClick={() => setError(null)}
              >
                Dismiss
              </button>
            </div>
          ) : null}

          {!manifest ? (
            <div className="text-sm text-zinc-500">Loading manifest…</div>
          ) : tab === "manifest" ? (
            <ManifestTab
              manifest={manifest}
              assets={assets}
              onSave={handleManifestSaved}
            />
          ) : tab === "dependencies" ? (
            <DependenciesTab
              manifest={manifest}
              onSave={handleManifestSaved}
              onError={setError}
            />
          ) : tab === "export" ? (
            <ExportTab />
          ) : (
            <AdvancedTab />
          )}
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-between px-6 py-3 border-t border-zinc-800 bg-zinc-950/40">
          <p className="text-xs text-zinc-500">
            Changes save per-tab. Use "Reload running game" to apply
            manifest changes to the live engine viewport.
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleReloadGame}
              title="Broadcast {type:'reset'} to the game iframe"
            >
              ⟳ Reload running game
            </Button>
            <Button variant="primary" size="sm" onClick={onClose}>
              Done
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
 * Manifest tab
 * ──────────────────────────────────────────────────────────────── */

interface ManifestFormFields {
  id: string;
  name: string;
  version: string;
  engine: string;
  description: string;
  author: string;
  homepage: string;
  startScene: string;
}

function pickFields(m: PackManifest): ManifestFormFields {
  const extra = m as unknown as Record<string, unknown>;
  return {
    id: typeof extra.id === "string" ? extra.id : "",
    name: m.name ?? "",
    version: m.version ?? "",
    engine: m.engine ?? "",
    description:
      typeof extra.description === "string" ? extra.description : "",
    author: typeof extra.author === "string" ? extra.author : "",
    homepage: typeof extra.homepage === "string" ? extra.homepage : "",
    startScene: m.startScene ?? "",
  };
}

function applyFields(m: PackManifest, f: ManifestFormFields): PackManifest {
  const out = { ...m } as PackManifest & Record<string, unknown>;
  out.name = f.name;
  out.version = f.version;
  out.engine = f.engine;
  out.startScene = f.startScene;
  if (f.id) out.id = f.id;
  else delete out.id;
  if (f.description) out.description = f.description;
  else delete out.description;
  if (f.author) out.author = f.author;
  else delete out.author;
  if (f.homepage) out.homepage = f.homepage;
  else delete out.homepage;
  return out;
}

function ManifestTab({
  manifest,
  assets,
  onSave,
}: {
  manifest: PackManifest;
  assets: AssetMeta[];
  onSave: (next: PackManifest) => Promise<void>;
}) {
  const [form, setForm] = useState<ManifestFormFields>(() => pickFields(manifest));
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    setForm(pickFields(manifest));
  }, [manifest]);

  const sceneAssets = useMemo(
    () => assets.filter((a) => a.path.startsWith("scenes/")),
    [assets],
  );

  // `manifest.scripts[]` was retired in WORLD_STATE "world.json
  // full-scope" (2026-05-17). The Scripts list now lives in
  // `world.json.scripts[]`. This panel keeps an empty-list display
  // for back-compat — a follow-up dispatch wires it to read from
  // world.json.
  const scriptsList: string[] = [];

  const handleSave = async () => {
    setSaving(true);
    try {
      const next = applyFields(manifest, form);
      await onSave(next);
      setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <section className="space-y-4">
        <h3 className="text-xs uppercase tracking-wide text-zinc-400">
          Metadata
        </h3>

        <FormField label="id" htmlFor="ps-id">
          <Input
            id="ps-id"
            value={form.id}
            onChange={(e) => setForm({ ...form, id: e.target.value })}
            placeholder="my-pack"
          />
        </FormField>
        <FormField label="name" htmlFor="ps-name">
          <Input
            id="ps-name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="version" htmlFor="ps-version">
            <Input
              id="ps-version"
              value={form.version}
              onChange={(e) => setForm({ ...form, version: e.target.value })}
              placeholder="0.1.0"
            />
          </FormField>
          <FormField label="engine" htmlFor="ps-engine">
            <Input
              id="ps-engine"
              value={form.engine}
              onChange={(e) => setForm({ ...form, engine: e.target.value })}
              placeholder="*"
            />
          </FormField>
        </div>
        <FormField label="description" htmlFor="ps-desc">
          <Textarea
            id="ps-desc"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={2}
          />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="author" htmlFor="ps-author">
            <Input
              id="ps-author"
              value={form.author}
              onChange={(e) => setForm({ ...form, author: e.target.value })}
            />
          </FormField>
          <FormField label="homepage" htmlFor="ps-home">
            <Input
              id="ps-home"
              value={form.homepage}
              onChange={(e) => setForm({ ...form, homepage: e.target.value })}
              placeholder="https://…"
            />
          </FormField>
        </div>

        <FormField label="startScene" htmlFor="ps-start">
          <select
            id="ps-start"
            value={form.startScene}
            onChange={(e) => setForm({ ...form, startScene: e.target.value })}
            className={cn(
              "flex h-9 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1 text-sm",
              "text-zinc-100 focus-visible:outline-none focus-visible:ring-2",
              "focus-visible:ring-amber-400",
            )}
          >
            {form.startScene &&
            !sceneAssets.some((s) => s.path === form.startScene) ? (
              <option value={form.startScene}>
                {form.startScene} (not in pack)
              </option>
            ) : null}
            {sceneAssets.length === 0 ? (
              <option value="">(no scenes in pack)</option>
            ) : null}
            {sceneAssets.map((s) => (
              <option key={s.path} value={s.path}>
                {s.path}
              </option>
            ))}
          </select>
        </FormField>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs uppercase tracking-wide text-zinc-400">
          Scripts
        </h3>
        {scriptsList.length === 0 ? (
          <p className="text-xs text-zinc-500">
            Pack-script lists now live in <code>world.json.scripts[]</code>.
            Inspecting them through the editor ships in a follow-up
            dispatch.
          </p>
        ) : (
          <ul className="rounded border border-zinc-800 bg-zinc-950 divide-y divide-zinc-800 text-xs font-mono">
            {scriptsList.map((p) => (
              <li key={p} className="px-3 py-1.5">
                {p}
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-zinc-500">
          Reordering / authoring scripts is editing-source territory —
          tracked separately.
        </p>
      </section>

      <div className="flex items-center justify-end gap-3 pt-2">
        {savedAt ? (
          <span className="text-xs text-emerald-400">
            Saved {new Date(savedAt).toLocaleTimeString()}
          </span>
        ) : null}
        <Button variant="primary" size="sm" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save manifest"}
        </Button>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
 * Dependencies tab
 * ──────────────────────────────────────────────────────────────── */

interface AddState {
  /** Open / closed flag for the Add dependency sub-modal. */
  open: boolean;
  url: string;
  userIntegrity: string;
  /** Fetch state: idle | fetching | ready. */
  status: "idle" | "fetching" | "ready" | "error";
  error: string | null;
  computedIntegrity: string | null;
  parentManifest: PackManifest | null;
  /** Pending mismatch — when set, we hold off on adding until the
   *  user picks Cancel or Update-hash-and-proceed. */
  mismatch: { computed: string; userProvided: string } | null;
}

const INITIAL_ADD_STATE: AddState = {
  open: false,
  url: "",
  userIntegrity: "",
  status: "idle",
  error: null,
  computedIntegrity: null,
  parentManifest: null,
  mismatch: null,
};

function DependenciesTab({
  manifest,
  onSave,
  onError,
}: {
  manifest: PackManifest;
  onSave: (next: PackManifest) => Promise<void>;
  onError: (msg: string) => void;
}) {
  const rows = useMemo(() => listRequires(manifest), [manifest]);
  const [add, setAdd] = useState<AddState>(INITIAL_ADD_STATE);
  const [refreshing, setRefreshing] = useState<number | null>(null);
  /** Dragged row index, or null. */
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  // ── Conflict detection ────────────────────────────────────────
  //
  // Conflicts re-compute after every change to the dependency list
  // (add / remove / reorder / enable / disable). The compute path
  // fetches every parent pack via `ChainResolver.resolveChain`, which
  // can be slow on first run (cold cache, ~25MB packs) but cheap on
  // subsequent runs (cache hits). Debounce so rapid edits don't
  // queue up N back-to-back resolves.
  const [report, setReport] = useState<ConflictReport | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  /** Row indexes whose details panels are currently expanded. */
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  /** Token to invalidate stale async results when manifest changes. */
  const scanToken = useRef(0);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runScan = useCallback(async (opts?: { force?: boolean }) => {
    const myToken = ++scanToken.current;
    setScanning(true);
    setScanError(null);
    if (opts?.force) clearChainCache();
    try {
      const { chain, errors } = await resolveDepChain(rows);
      if (myToken !== scanToken.current) return;
      const r = await detectConflicts(chain);
      if (myToken !== scanToken.current) return;
      setReport(r);
      if (errors.length > 0) {
        setScanError(
          `Scan finished with ${errors.length} unresolvable dep(s): ` +
            errors.map((e) => `${hostnameOf(e.url) || e.url} (${e.message})`).join("; "),
        );
      }
    } catch (err) {
      if (myToken !== scanToken.current) return;
      setScanError((err as Error).message);
      setReport(null);
    } finally {
      if (myToken === scanToken.current) setScanning(false);
    }
  }, [rows]);

  // Debounced auto-rescan on dependency-list changes.
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (rows.length === 0) {
      setReport({ conflicts: [], countsByDep: new Map() });
      setScanError(null);
      setScanning(false);
      return;
    }
    debounceTimer.current = setTimeout(() => {
      runScan();
    }, 350);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [runScan, rows.length, JSON.stringify(rows)]);

  const conflictsByDep = useMemo(() => {
    const map = new Map<string, Conflict[]>();
    if (!report) return map;
    for (const c of report.conflicts) {
      const involved = [c.winner, ...c.losers];
      for (const url of involved) {
        const arr = map.get(url) ?? [];
        arr.push(c);
        map.set(url, arr);
      }
    }
    return map;
  }, [report]);

  const toggleExpand = (i: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  // ---- Add flow ----

  const handleStartFetch = async () => {
    setAdd((a) => ({
      ...a,
      status: "fetching",
      error: null,
      computedIntegrity: null,
      parentManifest: null,
      mismatch: null,
    }));
    try {
      const parent = await fetchAndHashPack(add.url);
      const verify = verifyIntegrity(parent.integrity, add.userIntegrity);
      if (verify.kind === "mismatch") {
        setAdd((a) => ({
          ...a,
          status: "ready",
          computedIntegrity: parent.integrity,
          parentManifest: parent.manifest ?? null,
          mismatch: { computed: verify.computed, userProvided: verify.userProvided },
        }));
        return;
      }
      setAdd((a) => ({
        ...a,
        status: "ready",
        computedIntegrity: parent.integrity,
        parentManifest: parent.manifest ?? null,
        mismatch: null,
      }));
    } catch (err) {
      setAdd((a) => ({
        ...a,
        status: "error",
        error: (err as Error).message,
      }));
    }
  };

  const handleConfirmAdd = async (acceptComputed: boolean) => {
    if (!add.computedIntegrity) return;
    const finalIntegrity = acceptComputed
      ? add.computedIntegrity
      : add.userIntegrity || add.computedIntegrity;
    const parentId =
      add.parentManifest && typeof (add.parentManifest as unknown as { id?: string }).id === "string"
        ? (add.parentManifest as unknown as { id?: string }).id
        : undefined;
    const parentVersion = add.parentManifest?.version;
    const entry: PackRequiresEntry = {
      url: add.url.trim(),
      integrity: finalIntegrity,
    };
    if (parentId) entry.id = parentId;
    if (parentVersion) entry.version = `^${parentVersion}`;
    try {
      const next = addDependency(manifest, entry);
      await onSave(next);
      setAdd(INITIAL_ADD_STATE);
    } catch (err) {
      onError((err as Error).message);
    }
  };

  // ---- Refresh single entry ----

  const handleRefresh = async (i: number) => {
    const entry = rows[i];
    if (!entry?.url) return;
    setRefreshing(i);
    try {
      const parent = await fetchAndHashPack(entry.url);
      const verify = verifyIntegrity(parent.integrity, entry.integrity);
      if (verify.kind === "mismatch") {
        const ok = confirm(
          `Integrity mismatch for ${entry.url}.\n\n` +
            `  Your pin:  ${verify.userProvided}\n` +
            `  Actual:    ${verify.computed}\n\n` +
            `Click OK to update the pin to the actual hash, or Cancel to keep the existing pin.`,
        );
        if (!ok) return;
      }
      const patch: Partial<PackRequiresEntry> = { integrity: parent.integrity };
      if (parent.manifest?.version) {
        patch.version = `^${parent.manifest.version}`;
      }
      const next = patchDependency(manifest, i, patch);
      await onSave(next);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setRefreshing(null);
    }
  };

  // ---- Remove / toggle / reorder ----

  const handleRemove = async (i: number) => {
    const entry = rows[i];
    const label = entry?.id || entry?.url || `entry ${i}`;
    if (!confirm(`Remove dependency "${label}" from manifest.requires[]?`)) return;
    await onSave(removeDependency(manifest, i));
  };

  const handleToggle = async (i: number, enabled: boolean) => {
    await onSave(toggleDependencyEnabled(manifest, i, enabled));
  };

  const handlePatchVersion = async (i: number, version: string) => {
    const patch: Partial<PackRequiresEntry> = {};
    if (version) patch.version = version;
    else patch.version = undefined;
    await onSave(patchDependency(manifest, i, patch));
  };

  const handleDropOn = async (toIdx: number) => {
    if (dragIdx === null || dragIdx === toIdx) {
      setDragIdx(null);
      return;
    }
    await onSave(reorderDependency(manifest, dragIdx, toIdx));
    setDragIdx(null);
  };

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">
            manifest.requires[]
          </h3>
          <p className="text-xs text-zinc-500 mt-0.5">
            Bottom = highest precedence (last-in-chain wins per
            PACK_CHAIN.md). Disabled entries are skipped by the resolver.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => runScan({ force: true })}
            disabled={scanning || rows.length === 0}
            title="Re-fetch parent packs and re-scan for chain conflicts"
          >
            {scanning ? (
              <span className="inline-flex items-center gap-1">
                <span className="inline-block w-3 h-3 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                Scanning…
              </span>
            ) : (
              "Re-scan conflicts"
            )}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setAdd({ ...INITIAL_ADD_STATE, open: true })}
          >
            + Add dependency
          </Button>
        </div>
      </div>

      {scanError ? (
        <div className="rounded border border-amber-700 bg-amber-900/20 px-3 py-2 text-xs text-amber-200">
          {scanError}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="rounded border border-dashed border-zinc-800 px-4 py-6 text-sm text-zinc-500 text-center">
          No dependencies declared. Click "+ Add dependency" to extend
          another pack.
        </div>
      ) : (
        <ul className="rounded border border-zinc-800 divide-y divide-zinc-800">
          {rows.map((row, i) => {
            const enabled = row.enabled !== false;
            const url = row.url ?? "";
            const depConflicts = url ? conflictsByDep.get(url) ?? [] : [];
            const conflictCount = depConflicts.length;
            const isExpanded = expanded.has(i);
            return (
              <React.Fragment key={`${row.url ?? row.id ?? i}-${i}`}>
                <li
                  draggable
                  onDragStart={() => setDragIdx(i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleDropOn(i)}
                  className={cn(
                    "px-3 py-2 flex items-center gap-3 transition-colors",
                    dragIdx === i
                      ? "bg-amber-900/20"
                      : "hover:bg-zinc-800/30",
                    !enabled && "opacity-60",
                  )}
                >
                  <span
                    className="cursor-grab text-zinc-500 select-none"
                    title="Drag to reorder (bottom = highest precedence)"
                  >
                    ⋮⋮
                  </span>
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => handleToggle(i, e.target.checked)}
                    title={enabled ? "Disable this dependency" : "Enable this dependency"}
                    className="cursor-pointer"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-zinc-100 truncate">
                      {row.id || hostnameOf(row.url) || "(unnamed)"}
                    </div>
                    <div
                      className="text-[11px] text-zinc-500 truncate font-mono"
                      title={row.url}
                    >
                      {row.url || "(no url)"}
                    </div>
                  </div>
                  {enabled && report ? (
                    <ConflictBadge
                      count={conflictCount}
                      expanded={isExpanded}
                      onClick={() => toggleExpand(i)}
                    />
                  ) : enabled && scanning ? (
                    <span className="text-[11px] text-zinc-500 italic w-24 text-right">
                      scanning…
                    </span>
                  ) : null}
                  <Input
                    value={row.version ?? ""}
                    onChange={(e) => handlePatchVersion(i, e.target.value)}
                    placeholder="^0.1.0"
                    className="w-28 h-7 text-xs"
                    title="Semver range constraint"
                  />
                  <div
                    className="font-mono text-[11px] text-zinc-400 w-44 truncate"
                    title={row.integrity ?? "(no integrity)"}
                  >
                    {row.integrity ? (
                      <span title={row.integrity}>
                        ✓ {truncateIntegrity(row.integrity)}
                      </span>
                    ) : (
                      <span className="text-amber-500" title="No integrity pinned">
                        ⚠ no integrity
                      </span>
                    )}
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleRefresh(i)}
                    disabled={refreshing === i || !row.url}
                    title="Re-fetch and re-hash this dependency"
                  >
                    {refreshing === i ? "…" : "Refresh"}
                  </Button>
                  <button
                    onClick={() => handleRemove(i)}
                    className="text-zinc-500 hover:text-red-400 text-sm"
                    title="Remove dependency"
                  >
                    ×
                  </button>
                </li>
                {isExpanded && enabled ? (
                  <li className="bg-zinc-950/50 px-6 py-3 border-l-2 border-amber-700/60">
                    <ConflictDetailsPanel
                      depUrl={url}
                      depLabel={row.id || hostnameOf(row.url) || "(unnamed)"}
                      conflicts={depConflicts}
                    />
                  </li>
                ) : null}
              </React.Fragment>
            );
          })}
        </ul>
      )}

      {/* Add dependency sub-modal */}
      {add.open ? (
        <AddDependencyDialog
          state={add}
          onCancel={() => setAdd(INITIAL_ADD_STATE)}
          onUrlChange={(url) => setAdd((a) => ({ ...a, url }))}
          onIntegrityChange={(userIntegrity) =>
            setAdd((a) => ({ ...a, userIntegrity }))
          }
          onFetch={handleStartFetch}
          onConfirmAdd={() => handleConfirmAdd(false)}
          onAcceptComputed={() => handleConfirmAdd(true)}
        />
      ) : null}
    </div>
  );
}

function AddDependencyDialog({
  state,
  onCancel,
  onUrlChange,
  onIntegrityChange,
  onFetch,
  onConfirmAdd,
  onAcceptComputed,
}: {
  state: AddState;
  onCancel: () => void;
  onUrlChange: (s: string) => void;
  onIntegrityChange: (s: string) => void;
  onFetch: () => void;
  onConfirmAdd: () => void;
  onAcceptComputed: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-lg rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 py-3 border-b border-zinc-800">
          <h3 className="text-sm font-semibold">Add dependency</h3>
          <p className="text-xs text-zinc-500 mt-0.5">
            Editor fetches the URL, computes the SHA-256, and pre-fills
            the form. The pack bytes aren't stored — only the URL +
            hash land in your manifest.
          </p>
        </header>
        <div className="px-5 py-4 space-y-3">
          <FormField label="Pack URL" htmlFor="add-url">
            <Input
              id="add-url"
              value={state.url}
              onChange={(e) => onUrlChange(e.target.value)}
              placeholder="https://example.com/pack.apg"
              autoFocus
            />
          </FormField>
          <FormField label="Integrity (optional pin)" htmlFor="add-sri">
            <Input
              id="add-sri"
              value={state.userIntegrity}
              onChange={(e) => onIntegrityChange(e.target.value)}
              placeholder="sha256-…"
              className="font-mono"
            />
            <p className="text-[11px] text-zinc-500 mt-1">
              Leave blank to auto-populate from the fetched bytes.
              Paste an existing pin to verify it matches.
            </p>
          </FormField>

          {state.status === "fetching" ? (
            <div className="text-xs text-amber-300 flex items-center gap-2">
              <span className="inline-block w-3 h-3 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
              Fetching parent pack… (can take a moment, packs are typically 25+ MB)
            </div>
          ) : null}

          {state.status === "error" && state.error ? (
            <div className="text-xs text-red-300 bg-red-900/30 border border-red-700 rounded px-2 py-1.5">
              {state.error}
            </div>
          ) : null}

          {state.status === "ready" && state.mismatch ? (
            <div className="rounded border border-amber-700 bg-amber-900/30 px-3 py-2 space-y-2">
              <div className="text-xs font-semibold text-amber-200">
                Integrity mismatch
              </div>
              <div className="text-[11px] text-amber-100/80">
                The bytes we fetched don't match the pin you provided.
                Either the URL contents changed since you pinned, or
                someone is serving different bytes than you expected.
              </div>
              <dl className="text-[11px] font-mono space-y-1">
                <div>
                  <span className="text-zinc-500">Your pin: </span>
                  <span className="text-amber-100 break-all">
                    {state.mismatch.userProvided}
                  </span>
                </div>
                <div>
                  <span className="text-zinc-500">Actual:   </span>
                  <span className="text-emerald-300 break-all">
                    {state.mismatch.computed}
                  </span>
                </div>
              </dl>
            </div>
          ) : null}

          {state.status === "ready" && !state.mismatch ? (
            <div className="rounded border border-emerald-700 bg-emerald-900/20 px-3 py-2 text-[11px] space-y-1">
              <div className="text-emerald-200 font-semibold">
                Pack fetched + hashed
              </div>
              <div className="font-mono text-emerald-100 break-all">
                {state.computedIntegrity}
              </div>
              {state.parentManifest ? (
                <div className="text-zinc-400">
                  Parent manifest:{" "}
                  <span className="text-zinc-200">
                    {(state.parentManifest as unknown as { id?: string }).id ??
                      state.parentManifest.name}{" "}
                    @ {state.parentManifest.version}
                  </span>
                </div>
              ) : (
                <div className="text-zinc-400">
                  (no manifest.json in archive — fields auto-filled
                  from URL hostname)
                </div>
              )}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-zinc-800">
          <Button variant="secondary" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          {state.status === "idle" || state.status === "error" ? (
            <Button
              variant="primary"
              size="sm"
              onClick={onFetch}
              disabled={!state.url.trim()}
            >
              Fetch + hash
            </Button>
          ) : null}
          {state.status === "ready" && state.mismatch ? (
            <Button
              variant="primary"
              size="sm"
              onClick={onAcceptComputed}
              title="Update the pin to the computed hash and add the dependency"
            >
              Update hash and proceed
            </Button>
          ) : null}
          {state.status === "ready" && !state.mismatch ? (
            <Button variant="primary" size="sm" onClick={onConfirmAdd}>
              Add
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
 * Export tab (placeholder)
 * ──────────────────────────────────────────────────────────────── */

function ExportTab() {
  return (
    <div className="max-w-2xl space-y-3">
      <h3 className="text-sm font-semibold text-zinc-100">Export</h3>
      <div className="rounded border border-zinc-800 bg-zinc-950/50 p-4 text-sm text-zinc-400 leading-relaxed">
        <p>
          Export functionality (Build full <em>vs</em> Extend modes) lands
          in a future phase. Tracked as task <code>#192</code>.
        </p>
        <p className="mt-2 text-xs text-zinc-500">
          The tab is reserved here so the real Export UI ships without
          moving any other settings around.
        </p>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
 * Advanced tab (placeholder)
 * ──────────────────────────────────────────────────────────────── */

function AdvancedTab() {
  return (
    <div className="max-w-2xl space-y-3">
      <h3 className="text-sm font-semibold text-zinc-100">Advanced</h3>
      <div className="rounded border border-zinc-800 bg-zinc-950/50 p-4 text-sm text-zinc-400 leading-relaxed">
        <p>
          Build flags, community-store credentials, debug overrides,
          etc. — future phases.
        </p>
        <p className="mt-2 text-xs text-zinc-500">
          Reserved tab so the surface doesn't shift when these ship.
        </p>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
 * Local primitives
 * ──────────────────────────────────────────────────────────────── */

/**
 * Conflict count badge for a single dep row. Amber when conflicts
 * exist, subtle when none — the "all-clear" state stays out of the
 * way unless the modder hovers.
 */
function ConflictBadge({
  count,
  expanded,
  onClick,
}: {
  count: number;
  expanded: boolean;
  onClick: () => void;
}) {
  if (count === 0) {
    return (
      <span
        className="text-[11px] text-zinc-600 hover:text-zinc-300 cursor-default w-24 text-right"
        title="No chain conflicts detected for this dep"
      >
        ✓ no conflicts
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={
        expanded
          ? "Collapse conflict details"
          : "Show this dep's chain-conflict details"
      }
      className={cn(
        "px-2 h-6 rounded text-[11px] font-medium border w-24",
        "bg-amber-900/30 border-amber-700/60 text-amber-200",
        "hover:bg-amber-800/40 transition-colors",
      )}
    >
      {expanded ? "▾" : "▸"} {count} conflict{count === 1 ? "" : "s"}
    </button>
  );
}

const CONFLICT_KIND_LABEL: Record<Conflict["kind"], string> = {
  "asset-path": "asset",
  "manifest-sprite": "sprite",
  "manifest-item": "item",
  "manifest-prefab": "prefab",
  "manifest-sound": "sound",
  "tile-preset": "preset",
  "shader-material": "material",
  "manifest-script": "script",
};

/** Inline panel showing every conflict this dep is involved in. */
function ConflictDetailsPanel({
  depUrl,
  depLabel,
  conflicts,
}: {
  depUrl: string;
  depLabel: string;
  conflicts: Conflict[];
}) {
  if (conflicts.length === 0) {
    return (
      <div className="text-xs text-zinc-500">
        No conflicts for <span className="font-mono">{depLabel}</span>.
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <div className="text-xs text-amber-300 font-semibold">
        Conflicts for {depLabel}:
      </div>
      <ul className="text-[11px] font-mono space-y-1">
        {conflicts.map((c, idx) => {
          const isWinner = c.winner === depUrl;
          const others = isWinner ? c.losers : [c.winner];
          return (
            <li
              key={`${c.kind}-${c.identifier}-${idx}`}
              className="flex items-baseline gap-2"
              title={c.details ?? ""}
            >
              <span
                className={cn(
                  "px-1.5 py-px rounded text-[10px] uppercase tracking-wide font-sans",
                  isWinner
                    ? "bg-emerald-900/40 text-emerald-300 border border-emerald-700/40"
                    : "bg-zinc-800 text-zinc-400 border border-zinc-700",
                )}
              >
                {isWinner ? "WINS" : "LOST"}
              </span>
              <span className="text-zinc-500 text-[10px]">
                [{CONFLICT_KIND_LABEL[c.kind]}]
              </span>
              <span className="text-zinc-200 break-all">{c.identifier}</span>
              <span className="text-zinc-500">
                {isWinner ? "over" : "to"}
              </span>
              <span className="text-zinc-400 break-all">
                {others.map((u) => hostnameOf(u) || u).join(", ")}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FormField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={htmlFor}>{label}</Label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
