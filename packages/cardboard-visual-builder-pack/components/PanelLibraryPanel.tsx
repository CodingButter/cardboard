/**
 * PanelLibraryPanel — JSON Visual Builder VB4 draft library.
 *
 * A dock panel listing every draft persisted to the sidecar IDB
 * (`state/draftsStore.ts`). The user can:
 *
 *   • Click a row → loads the draft into the builder
 *     (`store.loadSpec(spec, name)`).
 *   • Click the trash icon → confirms then deletes the row.
 *   • Drop a `.json` file → imports it as a new draft named after
 *     the file (sans extension) and loads it into the builder.
 *
 * The panel subscribes to a `bumpRefresh` counter that the builder's
 * Save / Delete / Import actions increment after writing the IDB —
 * forcing this panel to re-list. The counter lives on the store so
 * popped-out windows + sibling panels stay in sync (every window
 * with the panel mounted re-fetches when the counter changes).
 */

import React from "react";
import { Trash2, FilePlus, Download, RefreshCw } from "lucide-react";
import { EmptyState } from "@cardboard/editor-shell";
import {
  listDrafts,
  deleteDraft,
  saveDraft,
  type PanelDraftRow,
} from "../state/draftsStore";
import {
  getPanelBuilderStore,
  bumpDraftsRefresh,
  type PanelBuilderActions,
  type PanelBuilderState,
} from "../state/usePanelBuilderStore";
import { useDraftsRefreshTick } from "../state/usePanelBuilderHooks";
import type { PanelSpec } from "../../../apps/editor/src/panel-renderer/types";

function getActions(): (PanelBuilderState & PanelBuilderActions) | null {
  const store = getPanelBuilderStore();
  if (!store) return null;
  return store.getState() as PanelBuilderState & PanelBuilderActions;
}

function isPanelSpec(value: unknown): value is PanelSpec {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.title === "string" &&
    typeof v.category === "string" &&
    typeof v.dockKind === "string" &&
    !!v.root &&
    typeof v.root === "object"
  );
}

function formatRelativeTime(ts: number): string {
  const delta = Date.now() - ts;
  const sec = Math.floor(delta / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

export function PanelLibraryPanel(): React.JSX.Element {
  const refreshTick = useDraftsRefreshTick();
  const [rows, setRows] = React.useState<PanelDraftRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [isOver, setIsOver] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const reload = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const all = await listDrafts();
      setRows(all);
    } catch (e) {
      setError((e as Error).message || "Failed to load drafts");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void reload();
  }, [reload, refreshTick]);

  const onLoadDraft = React.useCallback((row: PanelDraftRow) => {
    const actions = getActions();
    if (!actions) return;
    actions.loadSpec(row.spec, row.name);
  }, []);

  const onDeleteDraft = React.useCallback(
    async (row: PanelDraftRow) => {
      const ok = window.confirm(
        `Delete draft "${row.name}"? This can't be undone.`,
      );
      if (!ok) return;
      try {
        await deleteDraft(row.name);
        // If this was the open draft, clear the name marker on the
        // store so subsequent Saves don't silently overwrite a
        // freshly-deleted slot.
        const actions = getActions();
        if (actions && actions.currentDraftName === row.name) {
          actions.setCurrentDraftName(null);
        }
        bumpDraftsRefresh();
      } catch (e) {
        setError((e as Error).message || "Failed to delete draft");
      }
    },
    [],
  );

  const importFile = React.useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      if (!isPanelSpec(parsed)) {
        setError(
          `"${file.name}" doesn't look like a PanelSpec — missing id/title/category/dockKind/root.`,
        );
        return;
      }
      const name = file.name.replace(/\.json$/i, "") || `imported-${Date.now()}`;
      await saveDraft(name, parsed);
      const actions = getActions();
      if (actions) actions.loadSpec(parsed, name);
      bumpDraftsRefresh();
    } catch (e) {
      setError((e as Error).message || "Failed to import file");
    }
  }, []);

  const onDragOver = React.useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setIsOver(true);
    }
  }, []);
  const onDragLeave = React.useCallback(() => setIsOver(false), []);
  const onDrop = React.useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsOver(false);
      const files = Array.from(e.dataTransfer.files);
      const jsonFile = files.find(
        (f) => f.type === "application/json" || f.name.toLowerCase().endsWith(".json"),
      );
      if (jsonFile) void importFile(jsonFile);
    },
    [importFile],
  );

  const onPickFile = React.useCallback(() => {
    fileInputRef.current?.click();
  }, []);
  const onFileChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void importFile(file);
      // Reset so the same file can be re-imported later.
      e.target.value = "";
    },
    [importFile],
  );

  const exportRow = React.useCallback((row: PanelDraftRow) => {
    try {
      const blob = new Blob([JSON.stringify(row.spec, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${row.name}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message || "Failed to export draft");
    }
  }, []);

  return (
    <div
      className="flex flex-col h-full text-zinc-100"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      data-testid="panel-library"
    >
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-zinc-800">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500 flex-1">
          {rows.length} draft{rows.length === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          onClick={onPickFile}
          title="Import a .json file as a new draft"
          className="inline-flex items-center gap-1 text-xs text-zinc-300 px-1.5 py-0.5 rounded hover:bg-zinc-800"
        >
          <FilePlus size={12} /> Import
        </button>
        <button
          type="button"
          onClick={() => void reload()}
          title="Reload the draft list"
          className="inline-flex items-center text-xs text-zinc-300 px-1.5 py-0.5 rounded hover:bg-zinc-800"
        >
          <RefreshCw size={12} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          onChange={onFileChange}
          className="hidden"
          data-testid="panel-library-file-input"
        />
      </div>
      {error && (
        <div className="mx-2 my-1 text-[11px] text-rose-300 bg-rose-950/40 border border-rose-900/60 rounded px-2 py-1">
          {error}
        </div>
      )}
      <div
        className={[
          "flex-1 overflow-y-auto",
          isOver
            ? "outline outline-2 outline-amber-500/60 outline-offset-[-4px] bg-amber-500/5"
            : "",
        ].join(" ")}
      >
        {loading ? (
          <div className="p-4 text-xs text-zinc-500">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-4">
            <EmptyState
              title="No drafts yet"
              description="Save from the builder toolbar, or drop a .json file here to import."
            />
          </div>
        ) : (
          <ul className="flex flex-col gap-px p-1">
            {rows.map((row) => (
              <li key={row.name}>
                <div className="group flex items-center gap-1 px-2 py-1.5 rounded hover:bg-zinc-800/60">
                  <button
                    type="button"
                    onClick={() => onLoadDraft(row)}
                    className="flex-1 flex flex-col items-start text-left min-w-0"
                    title={`Load "${row.name}" into the builder`}
                  >
                    <span className="text-xs text-zinc-100 truncate w-full">
                      {row.name}
                    </span>
                    <span className="text-[10px] text-zinc-500 truncate w-full">
                      {row.spec.title || "Untitled"} · {formatRelativeTime(row.updatedAt)}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => exportRow(row)}
                    title={`Download "${row.name}.json"`}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-zinc-400 hover:text-zinc-100"
                    aria-label={`Export ${row.name}`}
                  >
                    <Download size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void onDeleteDraft(row)}
                    title={`Delete "${row.name}"`}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-zinc-400 hover:text-rose-300"
                    aria-label={`Delete ${row.name}`}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default PanelLibraryPanel;
