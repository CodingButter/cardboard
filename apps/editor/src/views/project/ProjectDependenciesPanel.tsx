import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PackManifest, PackRequiresEntry } from "@two_5_d/engine";
import { clearChainCache } from "@two_5_d/engine";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Input,
  Modal,
} from "../../components/ui";
import {
  PropertyRow,
  Badge,
  StatusPill,
  IconButton,
  ToggleSwitch,
  EmptyState,
  Tooltip,
} from "../../components/ui/index";
import { cn } from "../../lib/cn";
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
} from "../../lib/dependencyManager";
import {
  detectConflicts,
  type Conflict,
  type ConflictReport,
} from "../../lib/chainConflictDetector";
import { resolveDepChain } from "../../lib/resolveDepChain";
import { GripVertical, RefreshCcw, Trash2, Plus, Link as LinkIcon } from "lucide-react";

/**
 * ProjectDependenciesPanel — R4f Project tab → Dependencies sub-view.
 *
 * Carries the full dependency-management surface verbatim from the
 * old ProjectSettingsModal:
 *
 *   - manifest.requires[] add / remove / reorder / toggle (#194).
 *   - URL-import flow with `fetchAndHashPack` auto-integrity (#194).
 *   - Chain conflict detection + per-dep expand panel (#195).
 *   - Last-wins precedence note + bottom-row drag handles.
 *
 * Re-skinned to R2 primitives — Card / Badge / StatusPill / IconButton
 * / PropertyRow / Modal — but behaviour is unchanged.
 */

interface AddState {
  open: boolean;
  url: string;
  userIntegrity: string;
  status: "idle" | "fetching" | "ready" | "error";
  error: string | null;
  computedIntegrity: string | null;
  parentManifest: PackManifest | null;
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

export interface ProjectDependenciesPanelProps {
  manifest: PackManifest;
  onSave: (next: PackManifest) => Promise<void>;
  onError: (msg: string) => void;
}

export function ProjectDependenciesPanel({
  manifest,
  onSave,
  onError,
}: ProjectDependenciesPanelProps) {
  const rows = useMemo(() => listRequires(manifest), [manifest]);
  const [add, setAdd] = useState<AddState>(INITIAL_ADD_STATE);
  const [refreshing, setRefreshing] = useState<number | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  // ── Conflict detection (carried from ProjectSettingsModal #195). ──
  const [report, setReport] = useState<ConflictReport | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const scanToken = useRef(0);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runScan = useCallback(
    async (opts?: { force?: boolean }) => {
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
              errors
                .map((e) => `${hostnameOf(e.url) || e.url} (${e.message})`)
                .join("; "),
          );
        }
      } catch (err) {
        if (myToken !== scanToken.current) return;
        setScanError((err as Error).message);
        setReport(null);
      } finally {
        if (myToken === scanToken.current) setScanning(false);
      }
    },
    [rows],
  );

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

  // ── Add flow ──

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
      add.parentManifest &&
      typeof (add.parentManifest as unknown as { id?: string }).id === "string"
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

  // ── Refresh single entry ──

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

  // ── Remove / toggle / reorder ──

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

  // ── Render ──

  const totalConflicts = report?.conflicts.length ?? 0;
  const conflictPill: { variant: "ok" | "warn" | "error" | "neutral"; label: string } =
    scanning
      ? { variant: "neutral", label: "Scanning…" }
      : totalConflicts === 0
        ? { variant: "ok", label: "No conflicts" }
        : { variant: "warn", label: `${totalConflicts} conflict${totalConflicts === 1 ? "" : "s"}` };

  return (
    <div className="space-y-4 max-w-5xl">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>manifest.requires[]</CardTitle>
              <CardDescription>
                Bottom = highest precedence (last-in-chain wins per
                PACK_CHAIN.md § 4). Disabled entries are skipped by the
                resolver. Drag to reorder.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <StatusPill variant={conflictPill.variant}>{conflictPill.label}</StatusPill>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => runScan({ force: true })}
                disabled={scanning || rows.length === 0}
                title="Re-fetch parent packs and re-scan for chain conflicts"
              >
                {scanning ? "Scanning…" : "Re-scan"}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => setAdd({ ...INITIAL_ADD_STATE, open: true })}
              >
                <Plus size={14} className="mr-1" />
                Add dependency
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {scanError ? (
            <div className="mb-3 rounded border border-amber-700/60 bg-amber-900/20 px-3 py-2 text-xs text-amber-200">
              {scanError}
            </div>
          ) : null}

          {rows.length === 0 ? (
            <EmptyState
              icon={<LinkIcon size={26} />}
              title="No dependencies declared"
              description={
                "This pack stands alone. Click Add dependency to extend " +
                "another pack — the editor fetches the URL, computes its " +
                "SHA-256, and pins the hash for reproducibility."
              }
              action={
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setAdd({ ...INITIAL_ADD_STATE, open: true })}
                >
                  Add dependency
                </Button>
              }
              tutorial="project-dependencies"
            />
          ) : (
            <ul className="rounded border border-zinc-800 divide-y divide-zinc-800 overflow-hidden">
              {rows.map((row, i) => {
                const enabled = row.enabled !== false;
                const url = row.url ?? "";
                const depConflicts = url ? (conflictsByDep.get(url) ?? []) : [];
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
                      <Tooltip content="Drag to reorder (bottom = highest precedence)">
                        <span className="cursor-grab text-zinc-500 select-none inline-flex">
                          <GripVertical size={14} />
                        </span>
                      </Tooltip>
                      <ToggleSwitch
                        checked={enabled}
                        onChange={(v) => handleToggle(i, v)}
                        size="sm"
                        aria-label={enabled ? "Disable dependency" : "Enable dependency"}
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
                        <ConflictPill
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
                        className="font-mono text-[11px] w-44 truncate"
                        title={row.integrity ?? "(no integrity)"}
                      >
                        {row.integrity ? (
                          <Badge variant="emerald" outlined>
                            ✓ {truncateIntegrity(row.integrity)}
                          </Badge>
                        ) : (
                          <Badge variant="amber" outlined>
                            ⚠ no integrity
                          </Badge>
                        )}
                      </div>
                      <IconButton
                        icon={refreshing === i ? <span>…</span> : <RefreshCcw size={14} />}
                        tooltip="Re-fetch + re-hash this dependency"
                        size="sm"
                        onClick={() => handleRefresh(i)}
                        disabled={refreshing === i || !row.url}
                      />
                      <IconButton
                        icon={<Trash2 size={14} />}
                        tooltip="Remove dependency"
                        size="sm"
                        variant="danger"
                        onClick={() => handleRemove(i)}
                      />
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
        </CardContent>
      </Card>

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

/* ──────────────────────────────────────────────────────────────────
 * Add-dependency dialog (carried verbatim; re-skinned with R2 Modal).
 * ──────────────────────────────────────────────────────────────── */

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
  const footer =
    state.status === "idle" || state.status === "error" ? (
      <>
        <Button variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={onFetch}
          disabled={!state.url.trim()}
        >
          Fetch + hash
        </Button>
      </>
    ) : state.status === "ready" && state.mismatch ? (
      <>
        <Button variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={onAcceptComputed}
          title="Update the pin to the computed hash and add the dependency"
        >
          Update hash and proceed
        </Button>
      </>
    ) : state.status === "ready" && !state.mismatch ? (
      <>
        <Button variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={onConfirmAdd}>
          Add
        </Button>
      </>
    ) : (
      <Button variant="secondary" size="sm" onClick={onCancel}>
        Cancel
      </Button>
    );

  return (
    <Modal open onClose={onCancel} title="Add dependency" footer={footer}>
      <p className="text-xs text-zinc-500 mb-3 leading-relaxed">
        Editor fetches the URL, computes the SHA-256, and pre-fills the form.
        The pack bytes aren't stored — only the URL + hash land in your
        manifest.
      </p>
      <div className="space-y-3">
        <PropertyRow label="Pack URL" stacked>
          <Input
            value={state.url}
            onChange={(e) => onUrlChange(e.target.value)}
            placeholder="https://example.com/pack.apg"
            autoFocus
          />
        </PropertyRow>
        <PropertyRow label="Integrity (optional pin)" stacked>
          <Input
            value={state.userIntegrity}
            onChange={(e) => onIntegrityChange(e.target.value)}
            placeholder="sha256-…"
            className="font-mono"
          />
          <p className="text-[11px] text-zinc-500 mt-1">
            Leave blank to auto-populate from the fetched bytes. Paste an
            existing pin to verify it matches.
          </p>
        </PropertyRow>

        {state.status === "fetching" ? (
          <StatusPill variant="info">
            Fetching parent pack… (packs are typically 25+ MB)
          </StatusPill>
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
              The bytes we fetched don't match the pin you provided. Either
              the URL contents changed since you pinned, or someone is
              serving different bytes than you expected.
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
                (no manifest.json in archive — fields auto-filled from URL
                hostname)
              </div>
            )}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

/* ──────────────────────────────────────────────────────────────────
 * Conflict badges + details panel (kept structurally identical to the
 * legacy modal so behaviour stays the same).
 * ──────────────────────────────────────────────────────────────── */

function ConflictPill({
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
        className="text-[11px] text-zinc-600 cursor-default w-24 text-right"
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
              <Badge variant={isWinner ? "emerald" : "zinc"}>
                {isWinner ? "WINS" : "LOST"}
              </Badge>
              <span className="text-zinc-500 text-[10px]">
                [{CONFLICT_KIND_LABEL[c.kind]}]
              </span>
              <span className="text-zinc-200 break-all">{c.identifier}</span>
              <span className="text-zinc-500">{isWinner ? "over" : "to"}</span>
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
