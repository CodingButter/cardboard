import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Box,
  Cuboid,
  Image as ImageIcon,
  MapPin,
  ArrowRight,
  Sun,
  Eye,
  Layers,
  Camera,
  Sparkles,
  Plus,
  Trash2,
  Code2,
  Search,
  FileText,
  Save as SaveIcon,
  Copy,
  Check,
} from "lucide-react";
import type {
  DeclarativePrefab,
  PackManifest,
} from "@two_5_d/engine";
import type { SpriteDef } from "@two_5_d/engine/AssetPack";
import { EditorProjectStore } from "../lib/EditorProjectStore";
import {
  ComponentField,
  JsonComponentEditor,
} from "../components/ComponentForm";
import {
  BUILT_IN_COMPONENT_SCHEMAS,
  findComponentSchema,
  type ComponentFieldSpec,
} from "../lib/componentSchemas";
import { Button, Input, Label, Modal, Textarea } from "../components/ui";
import {
  Badge,
  CollapsibleSection,
  ColorChip,
  EmptyState,
  FilePicker,
  IconButton,
  KeyValueList,
  PanelHeader,
  PropertyRow,
  ScrollArea,
  Select,
  Slider,
  StatusPill,
  ToggleSwitch,
  Tooltip,
} from "../components/ui/index";
import { cn } from "../lib/cn";
import type { PrefabConversionResult } from "../lib/prefabConverter";
import {
  buildAnimationComponentFromSuggestion,
  computeAnimationWiringState,
} from "../lib/prefabAnimationWiring";
import { useStatusBar } from "../shell/StatusBarContext";
import { useEditorActions } from "../shell/EditorActionsContext";
import type { StatusBarSection } from "../components/ui/StatusBar";

/**
 * E-ENT — "Prefabs" workflow tab (file kept as EntitiesEditor for
 * historical reasons; the PrimaryTab label was renamed). Lays out
 * the per-EDITOR_REDESIGN.md §7.3 + PREFABS_EDITOR_ONLY.md surface.
 *
 * Prefabs are editor-only authoring templates — pure bundles of
 * component data, no runtime registry, no `api.spawn(name)` path.
 * Save writes the bundle into `manifest.prefabs` for editor consumption;
 * the engine ignores that field at runtime (see PREFABS_EDITOR_ONLY.md
 * §4). The "JS prefabs" legacy code path is preserved so existing
 * `api.registerPrefab(...)` calls in pack scripts still surface in the
 * list as read-only entries with a "Convert to declarative" affordance.
 *
 * Layout — strict 3-column grid (§7.3):
 *
 *   ┌──────────────┬───────────────────────────────┬──────────────┐
 *   │ Prefab list  │ Header strip (name + tags +   │ JSON preview │
 *   │ (left rail)  │  "+ Add component")           │ + Save +     │
 *   │  + palette   │ Component stack:              │ Save & Test  │
 *   │  + import    │  CollapsibleSection per       │ (right rail) │
 *   │              │  component, SchemaField rows  │              │
 *   └──────────────┴───────────────────────────────┴──────────────┘
 *
 * R2 primitives used throughout: PanelHeader, CollapsibleSection,
 * PropertyRow, Slider, ToggleSwitch, Select, ColorChip, FilePicker,
 * ScrollArea, Button, Badge, IconButton, EmptyState, Tooltip,
 * StatusPill, KeyValueList, Modal (delete confirm).
 *
 * The view registers a `save` action via EditorActionsContext (the
 * shell TopBar) and pushes three StatusBar sections — prefab-count,
 * prefab-name, prefab-validation — via useStatusBar.
 */
export interface EntitiesEditorProps {
  projectId: string;
  /** Bubble manifest writes to the parent so other modes refresh. */
  onManifestChanged?: () => void;
}

/** A row in the left rail. JS-rows are read-only; declarative are editable. */
interface PrefabRow {
  name: string;
  kind: "declarative" | "js";
  /** Only set for declarative rows. */
  data?: DeclarativePrefab;
  /** Source script path for JS-detected rows. */
  scriptPath?: string;
}

/**
 * Map of built-in component name → lucide icon (per §7.3 — "Component
 * icon resolved from a lookup table"). Falls back to a neutral Box icon
 * for modder-defined components.
 */
const COMPONENT_ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  Position: MapPin,
  Light: Sun,
  Sprite: ImageIcon,
  Movement: ArrowRight,
  Animation: Sparkles,
  Camera: Camera,
  Facing: Eye,
  Shader: Layers,
  MinimapMarker: MapPin,
};

function componentIcon(name: string, size = 14): React.ReactNode {
  const Cmp = COMPONENT_ICONS[name] ?? Box;
  return <Cmp size={size} />;
}

export function EntitiesEditor({
  projectId,
  onManifestChanged,
}: EntitiesEditorProps) {
  const [manifest, setManifest] = useState<PackManifest | null>(null);
  const [jsPrefabs, setJsPrefabs] = useState<
    ReadonlyArray<{ name: string; scriptPath: string }>
  >([]);
  /** UI-side draft of `manifest.prefabs`. Owned by the editor; flushed
   *  on Save so accidental edits to multiple prefabs don't all hit IDB
   *  every keystroke. */
  const [draft, setDraft] = useState<Record<string, DeclarativePrefab>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  /** Filter text for the prefab list. */
  const [filter, setFilter] = useState("");
  /**
   * Phase #196 — converter modal open state. When non-null, the modal
   * is open against the named JS prefab + script path.
   */
  const [converterTarget, setConverterTarget] = useState<
    { name: string; scriptPath: string } | null
  >(null);
  /** Per-project "keep as JS" suppression set. */
  const [keepAsJs, setKeepAsJs] = useState<ReadonlySet<string>>(new Set());
  /** Prefab id pending delete-confirmation Modal. null when modal is closed. */
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    const mf = await EditorProjectStore.loadManifest(projectId);
    setManifest(mf);
    setDraft({ ...(mf?.prefabs ?? {}) });
    setDirty(false);
    const detected = await detectJsPrefabs(projectId, mf);
    setJsPrefabs(detected);
    const keep = await loadKeepAsJs(projectId);
    setKeepAsJs(keep);
  }, [projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const declarativeRows: ReadonlyArray<PrefabRow> = useMemo(() => {
    const out: PrefabRow[] = [];
    for (const [id, data] of Object.entries(draft)) {
      out.push({ name: id, kind: "declarative", data });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }, [draft]);

  const jsRows: ReadonlyArray<PrefabRow> = useMemo(() => {
    return jsPrefabs.map((p) => ({
      name: p.name,
      kind: "js" as const,
      scriptPath: p.scriptPath,
    }));
  }, [jsPrefabs]);

  const activeRow: PrefabRow | undefined = useMemo(() => {
    if (!activeId) return undefined;
    return (
      declarativeRows.find((r) => r.name === activeId) ??
      jsRows.find((r) => r.name === activeId)
    );
  }, [activeId, declarativeRows, jsRows]);

  // Filtered rows for the left-rail prefab list.
  const filteredDeclarative = useMemo(() => {
    if (!filter.trim()) return declarativeRows;
    const f = filter.trim().toLowerCase();
    return declarativeRows.filter(
      (r) =>
        r.name.toLowerCase().includes(f) ||
        (r.data?.tags ?? []).some((t) => t.toLowerCase().includes(f)),
    );
  }, [declarativeRows, filter]);

  const filteredJs = useMemo(() => {
    if (!filter.trim()) return jsRows;
    const f = filter.trim().toLowerCase();
    return jsRows.filter((r) => r.name.toLowerCase().includes(f));
  }, [jsRows, filter]);

  const totalPrefabCount = declarativeRows.length + jsRows.length;

  // ── Mutations ──────────────────────────────────────────────────

  const handleNewPrefab = () => {
    let n = 1;
    let name = "untitled";
    while (draft[name] || jsPrefabs.some((j) => j.name === name)) {
      name = `untitled_${n++}`;
    }
    const next: DeclarativePrefab = {
      name,
      components: {},
    };
    setDraft({ ...draft, [name]: next });
    setActiveId(name);
    setDirty(true);
  };

  const handleDelete = (id: string) => {
    const copy = { ...draft };
    delete copy[id];
    setDraft(copy);
    if (activeId === id) setActiveId(null);
    setDirty(true);
  };

  const handleRename = (oldId: string, newId: string) => {
    if (oldId === newId) return;
    if (!newId.trim()) return;
    if (draft[newId] || jsPrefabs.some((j) => j.name === newId)) {
      setError(`A prefab named "${newId}" already exists.`);
      return;
    }
    const copy = { ...draft };
    const moved = { ...copy[oldId]!, name: newId };
    delete copy[oldId];
    copy[newId] = moved;
    setDraft(copy);
    if (activeId === oldId) setActiveId(newId);
    setDirty(true);
    setError(null);
  };

  const patchActive = (mutator: (cur: DeclarativePrefab) => DeclarativePrefab) => {
    if (!activeId) return;
    const cur = draft[activeId];
    if (!cur) return;
    const next = mutator(cur);
    setDraft({ ...draft, [activeId]: next });
    setDirty(true);
  };

  const addComponent = useCallback(
    (compName: string) => {
      if (!activeId) return;
      const cur = draft[activeId];
      if (!cur) return;
      if (cur.components[compName]) return;
      const schema = findComponentSchema(compName);
      const defaultData = schema
        ? cloneJson(schema.defaultData)
        : ({} as Record<string, unknown>);
      const next = {
        ...cur,
        components: { ...cur.components, [compName]: defaultData },
      };
      setDraft({ ...draft, [activeId]: next });
      setDirty(true);
    },
    [activeId, draft],
  );

  const removeComponent = (compName: string) => {
    patchActive((cur) => {
      const copy = { ...cur.components };
      delete copy[compName];
      return { ...cur, components: copy };
    });
  };

  const patchComponentData = (
    compName: string,
    next: Record<string, unknown>,
  ) => {
    patchActive((cur) => ({
      ...cur,
      components: { ...cur.components, [compName]: next },
    }));
  };

  // ── Save ──────────────────────────────────────────────────────

  /** Persist draft into `manifest.prefabs` and write the manifest. */
  const handleSave = useCallback(
    async (alsoReload: boolean) => {
      if (!manifest) return;
      setSaving(true);
      setError(null);
      try {
        const next: PackManifest = {
          ...manifest,
          prefabs: Object.keys(draft).length > 0 ? draft : undefined,
        };
        await EditorProjectStore.saveManifest(projectId, next);
        setManifest(next);
        setDirty(false);
        setSavedAt(Date.now());
        onManifestChanged?.();
        if (alsoReload) {
          for (const f of Array.from(window.parent.frames)) {
            try {
              f.postMessage({ type: "reset" }, "*");
            } catch {
              // Frames we don't own throw — ignore.
            }
          }
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setSaving(false);
      }
    },
    [manifest, draft, projectId, onManifestChanged],
  );

  // ── Editor-action registration (shell TopBar Save button) ─────
  const { register } = useEditorActions();
  useEffect(() => {
    return register({
      save: () => handleSave(false),
    });
  }, [register, handleSave]);

  // ── Sprite metadata for property pickers + Assets rail ────────
  const spriteIds = useMemo<ReadonlyArray<string>>(() => {
    if (!manifest?.sprites) return [];
    return Object.keys(manifest.sprites).sort();
  }, [manifest]);

  const spritesById = useMemo<Readonly<Record<string, SpriteDef>>>(() => {
    return manifest?.sprites ?? {};
  }, [manifest]);

  // ── Validation (very lightweight; placeholder for richer rules) ─
  //
  // WIRING: a richer validation system is planned (link from the
  // "N errors" badge to a validation log panel). For now we surface a
  // minimal sanity check: a declarative prefab with components is OK;
  // empty components → 1 warning. R5 / scripts phase can plug a real
  // validator into the same `prefabValidationIssues` slot.
  const validationIssues = useMemo<ReadonlyArray<string>>(() => {
    if (!activeRow || activeRow.kind !== "declarative") return [];
    const out: string[] = [];
    if (Object.keys(activeRow.data?.components ?? {}).length === 0) {
      out.push("Prefab has no components.");
    }
    return out;
  }, [activeRow]);

  // ── StatusBar wiring ──────────────────────────────────────────
  // Push prefab-count + prefab-name + prefab-validation while mounted.
  const { setSections } = useStatusBar();
  useEffect(() => {
    const sections: StatusBarSection[] = [
      {
        id: "prefab-count",
        label: "Prefabs",
        value: String(totalPrefabCount),
      },
      {
        id: "prefab-name",
        label: "Editing",
        value: activeId ?? "—",
      },
      {
        id: "prefab-validation",
        label: "Validation",
        value:
          activeRow?.kind === "declarative"
            ? validationIssues.length === 0
              ? "OK"
              : `${validationIssues.length} warning${
                  validationIssues.length === 1 ? "" : "s"
                }`
            : "—",
        align: "right",
      },
    ];
    setSections(sections);
    return () => setSections([]);
  }, [
    totalPrefabCount,
    activeId,
    activeRow,
    validationIssues,
    setSections,
  ]);

  // ── Drag-drop prefab JSON import (left-rail FilePicker) ────────
  const handleImportFiles = async (files: File[]) => {
    setError(null);
    for (const file of files) {
      try {
        const text = await file.text();
        const parsed = JSON.parse(text) as DeclarativePrefab;
        if (!parsed || typeof parsed !== "object" || !parsed.name) {
          throw new Error(`${file.name}: missing "name" field.`);
        }
        setDraft((prev) => ({ ...prev, [parsed.name]: parsed }));
        setActiveId(parsed.name);
        setDirty(true);
      } catch (err) {
        setError(`Import failed: ${(err as Error).message}`);
      }
    }
  };

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className="h-full min-h-[640px] bg-zinc-950 text-zinc-100">
      {/* ─── 3-column grid: prefab list │ component editor │ JSON preview ─── */}
      <div
        className="grid h-full min-h-0"
        style={{ gridTemplateColumns: "300px minmax(0,1fr) 380px" }}
      >
        {/* ─── LEFT — prefab list (+ palette + import) ─── */}
        <PrefabListRail
          declarative={filteredDeclarative}
          jsRows={filteredJs}
          activeId={activeId}
          keepAsJs={keepAsJs}
          filter={filter}
          totalCount={totalPrefabCount}
          onFilterChange={setFilter}
          onSelect={setActiveId}
          onNewPrefab={handleNewPrefab}
          onRequestDelete={setPendingDelete}
          onImportFiles={handleImportFiles}
          paletteEnabled={
            activeRow?.kind === "declarative" && activeRow.data !== undefined
          }
          presentComponents={
            activeRow?.kind === "declarative" && activeRow.data
              ? Object.keys(activeRow.data.components)
              : []
          }
          onAddComponent={addComponent}
        />

        {/* ─── CENTER — component editor ─── */}
        <section className="min-w-0 overflow-hidden flex flex-col bg-zinc-950/20 border-r border-zinc-800">
          {activeRow ? (
            activeRow.kind === "declarative" ? (
              <DeclarativeForm
                prefab={activeRow.data!}
                spriteIds={spriteIds}
                spritesById={spritesById}
                onRename={(next) => handleRename(activeRow.name, next)}
                onSetDescription={(d) =>
                  patchActive((cur) => ({
                    ...cur,
                    description: d || undefined,
                  }))
                }
                onSetTags={(t) => patchActive((cur) => ({ ...cur, tags: t }))}
                onAddComponent={addComponent}
                onRemoveComponent={removeComponent}
                onPatchComponent={patchComponentData}
              />
            ) : (
              <JsPrefabView
                name={activeRow.name}
                path={activeRow.scriptPath!}
                keptAsJs={keepAsJs.has(activeRow.name)}
                onConvert={() =>
                  setConverterTarget({
                    name: activeRow.name,
                    scriptPath: activeRow.scriptPath!,
                  })
                }
              />
            )
          ) : (
            <div className="h-full flex items-center justify-center p-6">
              <EmptyState
                icon={<Cuboid size={28} />}
                title="No prefab selected"
                description='Pick a prefab on the left or click "+ New" to author one. A prefab is a reusable bundle of components — engine-ignored at runtime, stamped onto entities at scene-save time.'
                tutorial="entities-intro"
              />
            </div>
          )}
        </section>

        {/* ─── RIGHT — JSON preview + Save ─── */}
        <JsonPreviewRail
          active={activeRow}
          dirty={dirty}
          saving={saving}
          savedAt={savedAt}
          error={error}
          validationIssues={validationIssues}
          onSave={() => handleSave(false)}
          onSaveAndTest={() => handleSave(true)}
          manifestReady={!!manifest}
        />
      </div>

      {/* ─── Delete-confirm Modal ─── */}
      <Modal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title={
          <span className="flex items-center gap-2">
            <Trash2 size={16} className="text-red-400" /> Delete prefab?
          </span>
        }
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPendingDelete(null)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                if (pendingDelete) handleDelete(pendingDelete);
                setPendingDelete(null);
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-zinc-300">
          This will remove{" "}
          <code className="font-mono text-amber-300">{pendingDelete}</code>{" "}
          from the prefab list. Existing entities stamped from this
          prefab keep their component data — only the template is
          removed.
        </p>
      </Modal>

      {converterTarget ? (
        <PrefabConverterModal
          projectId={projectId}
          name={converterTarget.name}
          scriptPath={converterTarget.scriptPath}
          manifest={manifest}
          onCancel={async () => {
            const next = new Set(keepAsJs);
            next.add(converterTarget.name);
            setKeepAsJs(next);
            await saveKeepAsJs(projectId, next);
            setConverterTarget(null);
          }}
          onApplied={async () => {
            setConverterTarget(null);
            await refresh();
          }}
        />
      ) : null}
    </div>
  );
}

// ── Left rail: prefab list + component palette ─────────────────────────

interface PrefabListRailProps {
  declarative: ReadonlyArray<PrefabRow>;
  jsRows: ReadonlyArray<PrefabRow>;
  activeId: string | null;
  keepAsJs: ReadonlySet<string>;
  filter: string;
  totalCount: number;
  onFilterChange: (next: string) => void;
  onSelect: (id: string) => void;
  onNewPrefab: () => void;
  /** Opens the delete-confirm Modal in the parent. */
  onRequestDelete: (id: string) => void;
  onImportFiles: (files: File[]) => void;
  paletteEnabled: boolean;
  presentComponents: ReadonlyArray<string>;
  onAddComponent: (name: string) => void;
}

function PrefabListRail({
  declarative,
  jsRows,
  activeId,
  keepAsJs,
  filter,
  totalCount,
  onFilterChange,
  onSelect,
  onNewPrefab,
  onRequestDelete,
  onImportFiles,
  paletteEnabled,
  presentComponents,
  onAddComponent,
}: PrefabListRailProps) {
  return (
    <aside className="min-w-0 border-r border-zinc-800 bg-zinc-950/40 flex flex-col min-h-0">
      <PanelHeader
        title="Prefabs"
        action={
          <>
            <Badge variant="zinc">{totalCount}</Badge>
            <Tooltip content="New declarative prefab" side="bottom">
              <Button
                variant="primary"
                size="sm"
                onClick={onNewPrefab}
                className="h-7 px-2 text-[11px]"
              >
                <Plus size={12} className="mr-1" />
                New
              </Button>
            </Tooltip>
          </>
        }
      />

      {/* Search input. */}
      <div className="px-3 py-2 border-b border-zinc-800">
        <div className="relative">
          <Search
            size={12}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none"
          />
          <Input
            value={filter}
            onChange={(e) => onFilterChange(e.target.value)}
            placeholder="Search prefabs…"
            className="h-8 pl-7 text-xs"
          />
        </div>
      </div>

      {/* Scrollable prefab list. */}
      <ScrollArea className="flex-1 min-h-0">
        <ul className="py-1">
          {declarative.length === 0 && jsRows.length === 0 ? (
            <li className="px-4 py-3 text-xs text-zinc-500">
              {filter
                ? "No prefabs match that search."
                : 'No prefabs yet. Click "+ New" to author one.'}
            </li>
          ) : null}

          {declarative.length > 0 ? (
            <li className="px-3 mt-1 mb-1">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
                User prefabs
              </div>
            </li>
          ) : null}

          {declarative.map((row) => {
            const active = activeId === row.name;
            return (
              <li
                key={`d:${row.name}`}
                className={cn(
                  "group px-3 py-2 cursor-pointer border-l-2 transition-colors",
                  "flex items-center justify-between gap-2",
                  active
                    ? "bg-amber-500/10 border-amber-400 text-amber-200"
                    : "border-transparent hover:bg-zinc-800/40 text-zinc-100",
                )}
                onClick={() => onSelect(row.name)}
              >
                <div className="min-w-0 flex items-center gap-2">
                  <Cuboid
                    size={14}
                    className={active ? "text-amber-300" : "text-zinc-500"}
                  />
                  <div className="min-w-0">
                    <div className="text-sm truncate">{row.name}</div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[10px] text-zinc-500">
                        {Object.keys(row.data?.components ?? {}).length} comp
                        {Object.keys(row.data?.components ?? {}).length === 1
                          ? ""
                          : "s"}
                      </span>
                      {row.data?.tags?.slice(0, 2).map((t) => (
                        <Badge key={t} variant="zinc" shape="pill">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
                <Tooltip content="Delete prefab" side="left">
                  <IconButton
                    icon={<Trash2 size={12} />}
                    tooltip="Delete prefab"
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRequestDelete(row.name);
                    }}
                    className="opacity-0 group-hover:opacity-100"
                  />
                </Tooltip>
              </li>
            );
          })}

          {jsRows.length > 0 ? (
            <li className="px-3 mt-3 mb-1">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
                From scripts
              </div>
            </li>
          ) : null}
          {jsRows.map((row) => {
            const active = activeId === row.name;
            return (
              <li
                key={`j:${row.scriptPath}:${row.name}`}
                className={cn(
                  "px-3 py-2 cursor-pointer border-l-2 transition-colors",
                  active
                    ? "bg-amber-500/10 border-amber-400 text-amber-200"
                    : "border-transparent hover:bg-zinc-800/40 text-zinc-100",
                )}
                onClick={() => onSelect(row.name)}
                title={row.scriptPath}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex items-center gap-2">
                    <Code2
                      size={14}
                      className={active ? "text-amber-300" : "text-zinc-500"}
                    />
                    <span className="text-sm truncate">{row.name}</span>
                  </div>
                  {keepAsJs.has(row.name) ? (
                    <Badge variant="zinc">JS·kept</Badge>
                  ) : (
                    <Badge variant="amber">JS</Badge>
                  )}
                </div>
                <div className="ml-6 text-[10px] text-zinc-500 truncate font-mono">
                  {row.scriptPath}
                </div>
              </li>
            );
          })}
        </ul>
      </ScrollArea>

      {/* Component palette + import — collapsible sections so they
       *  don't crowd the prefab list. */}
      <div className="shrink-0 border-t border-zinc-800">
        <CollapsibleSection
          title="Component palette"
          defaultOpen={paletteEnabled}
        >
          {paletteEnabled ? (
            <div className="grid grid-cols-2 gap-1.5">
              {BUILT_IN_COMPONENT_SCHEMAS.map((s) => {
                const present = presentComponents.includes(s.name);
                return (
                  <Tooltip
                    key={s.name}
                    content={
                      present ? "Already on prefab" : `Add ${s.name} component`
                    }
                    side="top"
                  >
                    <button
                      type="button"
                      disabled={present}
                      onClick={() => onAddComponent(s.name)}
                      className={cn(
                        "flex items-center gap-1.5 px-2 h-7 rounded-md border text-[11px]",
                        "transition-colors",
                        present
                          ? "border-zinc-800 bg-zinc-900/40 text-zinc-600 cursor-not-allowed"
                          : "border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-amber-500/60 hover:bg-amber-500/5 hover:text-amber-200 cursor-pointer",
                      )}
                    >
                      {componentIcon(s.name, 12)}
                      <span className="truncate">{s.name}</span>
                    </button>
                  </Tooltip>
                );
              })}
            </div>
          ) : (
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              Select a declarative prefab to add components.
            </p>
          )}
        </CollapsibleSection>

        <CollapsibleSection title="Import" defaultOpen={false}>
          <FilePicker
            mode="dropzone"
            accept="application/json,.json"
            multiple
            onFiles={onImportFiles}
            className="!py-3 !px-2"
          >
            <FileText size={18} className="text-zinc-500" />
            <div className="text-[11px] text-zinc-400 leading-tight">
              Drag &amp; drop prefab JSON
            </div>
          </FilePicker>
        </CollapsibleSection>
      </div>
    </aside>
  );
}

// ── Right rail: JSON preview + Save (§7.3) ─────────────────────────────

interface JsonPreviewRailProps {
  active: PrefabRow | undefined;
  dirty: boolean;
  saving: boolean;
  savedAt: number | null;
  error: string | null;
  validationIssues: ReadonlyArray<string>;
  onSave: () => void;
  onSaveAndTest: () => void;
  manifestReady: boolean;
}

/**
 * Right inspector (§7.3): JSON PREVIEW card with a read-only monospace
 * block of the resolved prefab JSON, a KeyValueList readout of prefab
 * stats (component count, tag count, validation), and the SAVE +
 * SAVE & TEST action buttons at the bottom.
 */
function JsonPreviewRail({
  active,
  dirty,
  saving,
  savedAt,
  error,
  validationIssues,
  onSave,
  onSaveAndTest,
  manifestReady,
}: JsonPreviewRailProps) {
  const [copied, setCopied] = useState(false);
  const json = useMemo(() => {
    if (!active) return "// No prefab selected.";
    if (active.kind === "js") {
      return `// JS prefab (read-only) — registered via api.registerPrefab\n// in ${active.scriptPath ?? "?"}.`;
    }
    return JSON.stringify(active.data ?? {}, null, 2);
  }, [active]);

  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore — non-secure context fallback would go here */
    }
  };

  const compCount =
    active?.kind === "declarative"
      ? Object.keys(active.data?.components ?? {}).length
      : 0;
  const tagCount =
    active?.kind === "declarative" ? (active.data?.tags?.length ?? 0) : 0;

  const saveState: "saved" | "saving" | "dirty" | "error" | "idle" = error
    ? "error"
    : saving
    ? "saving"
    : dirty
    ? "dirty"
    : savedAt
    ? "saved"
    : "idle";

  const savePill: React.ReactNode =
    saveState === "saving" ? (
      <StatusPill variant="info">Saving…</StatusPill>
    ) : saveState === "dirty" ? (
      <StatusPill variant="warn">Unsaved changes</StatusPill>
    ) : saveState === "error" ? (
      <StatusPill variant="error">Save failed</StatusPill>
    ) : saveState === "saved" ? (
      <StatusPill variant="ok">
        Saved {savedAt ? new Date(savedAt).toLocaleTimeString() : ""}
      </StatusPill>
    ) : (
      <StatusPill variant="neutral" noDot>
        Ready
      </StatusPill>
    );

  const validationPill: React.ReactNode =
    active?.kind === "declarative" ? (
      validationIssues.length === 0 ? (
        <StatusPill variant="ok">OK</StatusPill>
      ) : (
        <Tooltip content={validationIssues.join(" · ")} side="top">
          <StatusPill variant="warn">
            {validationIssues.length} warning
            {validationIssues.length === 1 ? "" : "s"}
          </StatusPill>
        </Tooltip>
      )
    ) : active?.kind === "js" ? (
      <StatusPill variant="neutral">read-only</StatusPill>
    ) : (
      <StatusPill variant="neutral">—</StatusPill>
    );

  return (
    <aside className="min-w-0 border-l border-zinc-800 bg-zinc-950/40 flex flex-col min-h-0">
      <PanelHeader
        title="JSON Preview"
        action={
          <Tooltip
            content={copied ? "Copied!" : "Copy JSON to clipboard"}
            side="bottom"
          >
            <IconButton
              icon={
                copied ? (
                  <Check size={14} className="text-green-400" />
                ) : (
                  <Copy size={14} />
                )
              }
              tooltip={copied ? "Copied" : "Copy JSON"}
              variant="ghost"
              size="sm"
              onClick={copy}
              disabled={!active || active.kind !== "declarative"}
            />
          </Tooltip>
        }
      />

      {/* Stats readout — KeyValueList (R2 primitive). */}
      <div className="px-3 py-2 border-b border-zinc-800">
        <KeyValueList
          density="dense"
          divided={false}
          rows={[
            {
              label: "Prefab",
              value: (
                <span className="font-mono text-zinc-200 truncate">
                  {active?.name ?? "—"}
                </span>
              ),
            },
            {
              label: "Kind",
              value: (
                <Badge variant={active?.kind === "js" ? "amber" : "zinc"}>
                  {active?.kind ?? "—"}
                </Badge>
              ),
            },
            { label: "Components", value: String(compCount) },
            { label: "Tags", value: String(tagCount) },
            { label: "Validation", value: validationPill },
            { label: "Save", value: savePill },
          ]}
        />
      </div>

      {/* JSON body — monospace, read-only, scrollable. */}
      <div className="flex-1 min-h-0 p-3">
        <div className="h-full rounded-md border border-zinc-800 bg-zinc-900/60 overflow-hidden">
          <ScrollArea className="h-full">
            <pre className="px-3 py-2.5 text-[11px] font-mono text-zinc-300 leading-relaxed whitespace-pre-wrap break-words">
              {json}
            </pre>
          </ScrollArea>
        </div>
      </div>

      {/* Save action footer. */}
      <div className="shrink-0 border-t border-zinc-800 p-3 flex flex-col gap-2 bg-zinc-950/60">
        {error ? (
          <div className="text-[11px] text-red-300 leading-snug">{error}</div>
        ) : null}
        <Tooltip content="Save the current prefab edits" side="top">
          <Button
            variant="primary"
            size="md"
            disabled={saving || !dirty || !manifestReady}
            onClick={onSave}
            className="w-full h-10 text-sm"
          >
            <SaveIcon size={14} className="mr-1.5" />
            Save
          </Button>
        </Tooltip>
        <Tooltip
          content="Save and reload the engine in Play mode"
          side="top"
        >
          <Button
            variant="secondary"
            size="md"
            disabled={saving || !manifestReady}
            onClick={onSaveAndTest}
            className="w-full"
          >
            Save &amp; Test
          </Button>
        </Tooltip>
      </div>
    </aside>
  );
}

// ── Center pane: schema-driven editor for one declarative prefab ──────

function DeclarativeForm({
  prefab,
  spriteIds,
  spritesById,
  onRename,
  onSetDescription,
  onSetTags,
  onAddComponent,
  onRemoveComponent,
  onPatchComponent,
}: {
  prefab: DeclarativePrefab;
  spriteIds: ReadonlyArray<string>;
  spritesById: Readonly<Record<string, SpriteDef>>;
  onRename: (next: string) => void;
  onSetDescription: (next: string) => void;
  onSetTags: (next: string[]) => void;
  onAddComponent: (name: string) => void;
  onRemoveComponent: (name: string) => void;
  onPatchComponent: (name: string, next: Record<string, unknown>) => void;
}) {
  const [nameDraft, setNameDraft] = useState(prefab.name);
  useEffect(() => {
    setNameDraft(prefab.name);
  }, [prefab.name]);

  const presentComponents = Object.keys(prefab.components);
  const availableToAdd = BUILT_IN_COMPONENT_SCHEMAS.map((s) => s.name).filter(
    (n) => !presentComponents.includes(n),
  );

  // Same wiring analysis the old layout used; surfaces the auto-add
  // Animation prompt + the mismatch warning under the Animation row.
  const wiring = useMemo(
    () => computeAnimationWiringState(prefab, spritesById),
    [prefab, spritesById],
  );
  const {
    spriteAnimationNames,
    suggestAnimation,
    animationMismatch,
    animationCurrent,
  } = wiring;

  const addAnimationFromSuggestion = () => {
    const payload = buildAnimationComponentFromSuggestion(
      spriteAnimationNames,
    );
    if (!payload) return;
    onAddComponent("Animation");
    onPatchComponent("Animation", payload);
  };

  const tagsInput = (prefab.tags ?? []).join(", ");

  return (
    <ScrollArea className="flex-1 min-h-0">
      <div className="p-5 space-y-5 max-w-3xl mx-auto">
        {/* ─── Prefab header card ─── */}
        <section className="rounded-lg border border-zinc-800 bg-zinc-950/40 overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-3">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className="h-8 w-8 rounded-md bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
                <Cuboid size={16} className="text-amber-400" />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium leading-none mb-1">
                  Editing prefab
                </div>
                <Input
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={() => {
                    const trimmed = nameDraft.trim();
                    if (trimmed && trimmed !== prefab.name) onRename(trimmed);
                    else setNameDraft(prefab.name);
                  }}
                  placeholder="zombie"
                  className="h-7 font-mono text-sm bg-transparent border-0 shadow-none px-0 focus-visible:bg-zinc-900 focus-visible:px-2 -ml-0.5"
                />
              </div>
            </div>
            <div className="shrink-0 flex items-center gap-2">
              <Badge variant="zinc" outlined>
                {Object.keys(prefab.components).length} comp
                {Object.keys(prefab.components).length === 1 ? "" : "s"}
              </Badge>
              {availableToAdd.length > 0 ? (
                <Select
                  size="sm"
                  options={[
                    { value: "", label: "+ Add component" },
                    ...availableToAdd.map((n) => ({ value: n, label: n })),
                  ]}
                  value=""
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v) {
                      onAddComponent(v);
                      e.target.value = "";
                    }
                  }}
                  className="!w-40"
                />
              ) : (
                <Badge variant="amber" outlined>
                  All built-ins attached
                </Badge>
              )}
            </div>
          </div>

          <div className="px-4 py-3 space-y-1 divide-y divide-zinc-800/60">
            <PropertyRow
              label="Description"
              stacked
              hint="Optional — shown in the prefab list."
            >
              <Textarea
                value={prefab.description ?? ""}
                onChange={(e) => onSetDescription(e.target.value)}
                placeholder="What does this prefab do?"
                rows={2}
                className="font-sans"
              />
            </PropertyRow>
            <PropertyRow
              label="Tags"
              stacked
              hint="Comma-separated — used for filtering in the prefab list."
            >
              <Input
                value={tagsInput}
                onChange={(e) => {
                  const parts = e.target.value
                    .split(",")
                    .map((p) => p.trim())
                    .filter((p) => p.length > 0);
                  onSetTags(parts);
                }}
                placeholder="enemy, undead"
              />
            </PropertyRow>
            <PropertyRow label="Prefab id" hint="Used by api.spawn().">
              <Label className="font-mono text-zinc-300 normal-case tracking-normal">
                {prefab.name}
              </Label>
            </PropertyRow>
          </div>
        </section>

        {/* ─── Components stack ─── */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs uppercase tracking-wider text-zinc-400 font-semibold">
              Components
            </h3>
            <Badge variant="zinc">{presentComponents.length}</Badge>
          </div>

          {presentComponents.length === 0 ? (
            <EmptyState
              icon={<Plus size={24} />}
              title="No components yet"
              description="Add components from the palette in the left rail. Position + Sprite + optional Light is a typical entity recipe."
              tutorial="entities-intro"
            />
          ) : (
            <div className="space-y-2">
              {presentComponents.map((name) => {
                let banner: React.ReactNode = null;
                if (name === "Sprite" && suggestAnimation) {
                  banner = (
                    <div
                      data-testid="anim-suggestion"
                      className="rounded border border-amber-700/60 bg-amber-900/20 p-2 text-[11px] text-amber-200 flex items-center justify-between gap-2"
                    >
                      <span>
                        This sprite has {spriteAnimationNames.length}{" "}
                        animation
                        {spriteAnimationNames.length === 1 ? "" : "s"} defined.
                      </span>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={addAnimationFromSuggestion}
                      >
                        + Add Animation component
                      </Button>
                    </div>
                  );
                } else if (name === "Animation" && animationMismatch) {
                  banner = (
                    <div className="rounded border border-amber-700/60 bg-amber-900/20 p-2 text-[11px] text-amber-200">
                      {spriteAnimationNames.length === 0
                        ? "No Sprite component (or imageId points at a sprite without animations) — the Animation component is inert."
                        : `current = "${animationCurrent}" is not in the sprite's animations: ${spriteAnimationNames.join(", ")}.`}
                    </div>
                  );
                }
                return (
                  <ComponentBlock
                    key={name}
                    name={name}
                    data={prefab.components[name] as Record<string, unknown>}
                    spriteIds={spriteIds}
                    animationNames={spriteAnimationNames}
                    banner={banner}
                    onPatch={(next) => onPatchComponent(name, next)}
                    onRemove={() => onRemoveComponent(name)}
                  />
                );
              })}
            </div>
          )}
        </section>
      </div>
    </ScrollArea>
  );
}

// ── Component block (CollapsibleSection wrapping schema fields) ────────

interface ComponentBlockProps {
  name: string;
  data: Record<string, unknown> | undefined;
  spriteIds: ReadonlyArray<string>;
  animationNames: ReadonlyArray<string>;
  banner?: React.ReactNode;
  onPatch: (next: Record<string, unknown>) => void;
  onRemove: () => void;
}

/**
 * One component block on the prefab. CollapsibleSection wrapper +
 * PropertyRow-per-field body. Replaces the legacy `<ComponentSubform/>`
 * with the R2 primitive stack. The underlying `ComponentField` widgets
 * are reused from `ComponentForm.tsx` for non-trivial field kinds
 * (vec2/vec3/animationName) — that helper has special-case logic we
 * don't want to reimplement here.
 *
 * For the common kinds (number, boolean, color3, string) we render via
 * R2 primitives (Slider, ToggleSwitch, ColorChip, Select) inside
 * PropertyRow so the visual contract matches §7.3.
 */
function ComponentBlock({
  name,
  data,
  spriteIds,
  animationNames,
  banner,
  onPatch,
  onRemove,
}: ComponentBlockProps) {
  const schema = findComponentSchema(name);
  const safe = data ?? {};
  const [enabled, setEnabled] = useState(true);

  const remove = (
    <Tooltip content="Remove component" side="left">
      <IconButton
        icon={<Trash2 size={12} />}
        tooltip="Remove component"
        variant="ghost"
        size="sm"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      />
    </Tooltip>
  );

  // Modder-defined components without a known schema fall through to
  // the JSON textarea — same path the legacy ComponentSubform took.
  if (!schema) {
    return (
      <CollapsibleSection
        title={
          <span className="flex items-center gap-2">
            {name}{" "}
            <Badge variant="zinc">JSON</Badge>
          </span>
        }
        icon={componentIcon(name)}
        defaultOpen
        trailing={
          <div className="flex items-center gap-1">
            {remove}
          </div>
        }
      >
        {banner ? <div className="mb-2">{banner}</div> : null}
        <JsonComponentEditor data={safe} onPatch={onPatch} />
      </CollapsibleSection>
    );
  }

  return (
    <CollapsibleSection
      title={name}
      icon={componentIcon(name)}
      defaultOpen
      trailing={
        <div className="flex items-center gap-1">
          <Tooltip
            content="Disable this component in the prefab (UI-only, R5)"
            side="top"
          >
            <ToggleSwitch
              checked={enabled}
              onChange={setEnabled}
              size="sm"
              aria-label={`Enable ${name}`}
            />
          </Tooltip>
          {remove}
        </div>
      }
    >
      {banner ? <div className="mb-2">{banner}</div> : null}
      <div className="divide-y divide-zinc-800/60">
        {schema.fields.map((field) => (
          <SchemaField
            key={field.key}
            componentName={name}
            field={field}
            value={safe[field.key]}
            spriteIds={spriteIds}
            animationNames={animationNames}
            onChange={(v) => onPatch({ ...safe, [field.key]: v })}
          />
        ))}
      </div>
    </CollapsibleSection>
  );
}

// ── SchemaField — one PropertyRow per schema field ────────────────────

interface SchemaFieldProps {
  componentName: string;
  field: ComponentFieldSpec;
  value: unknown;
  spriteIds: ReadonlyArray<string>;
  animationNames: ReadonlyArray<string>;
  onChange: (next: unknown) => void;
}

function SchemaField({
  componentName,
  field,
  value,
  spriteIds,
  animationNames,
  onChange,
}: SchemaFieldProps) {
  const label = field.label ?? field.key;

  switch (field.kind) {
    case "number": {
      const n = typeof value === "number" ? value : 0;
      const hasRange = field.min !== undefined && field.max !== undefined;
      if (hasRange) {
        return (
          <PropertyRow label={label} hint={field.hint}>
            <Slider
              value={Number.isFinite(n) ? n : 0}
              min={field.min!}
              max={field.max!}
              step={field.step ?? 0.01}
              onChange={onChange}
              valueLabel={(Number.isFinite(n) ? n : 0).toFixed(2)}
            />
          </PropertyRow>
        );
      }
      // No range → numeric input.
      return (
        <PropertyRow label={label} hint={field.hint}>
          <Input
            type="number"
            value={Number.isFinite(n) ? n : 0}
            step={field.step ?? 0.01}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (Number.isFinite(v)) onChange(v);
            }}
            className="font-mono"
          />
        </PropertyRow>
      );
    }

    case "boolean": {
      return (
        <PropertyRow label={label} hint={field.hint}>
          <ToggleSwitch
            checked={Boolean(value)}
            onChange={onChange}
            aria-label={label}
          />
        </PropertyRow>
      );
    }

    case "color3": {
      const arr =
        Array.isArray(value) && value.length === 3
          ? (value as number[])
          : [1, 1, 1];
      const hex = rgbArrayToHex(arr);
      return (
        <PropertyRow label={label} hint={field.hint}>
          <ColorChip
            value={hex}
            onChange={(next) => {
              const parsed = hexToRgbArray(next);
              if (parsed) onChange(parsed);
            }}
          />
        </PropertyRow>
      );
    }

    case "string": {
      const s = typeof value === "string" ? value : "";
      // Special case: Sprite.imageId → Select sourced from manifest.
      if (
        componentName === "Sprite" &&
        field.key === "imageId" &&
        spriteIds.length > 0
      ) {
        return (
          <PropertyRow label={label} hint={field.hint}>
            <Select
              value={s}
              onChange={(e) => onChange(e.target.value)}
              options={[
                { value: "", label: "(none)" },
                ...spriteIds.map((id) => ({ value: id, label: id })),
              ]}
            />
          </PropertyRow>
        );
      }
      return (
        <PropertyRow label={label} hint={field.hint}>
          <Input
            value={s}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.hint}
            className="font-mono"
          />
        </PropertyRow>
      );
    }

    case "vec2":
    case "vec3":
    case "animationName": {
      // Composite / context-aware fields — defer to the existing
      // ComponentField helper. It already handles the vector grids and
      // the animation-name fallback logic. Wrap in a PropertyRow so the
      // outer layout matches its siblings.
      return (
        <PropertyRow label={label} stacked hint={field.hint}>
          <ComponentField
            field={field}
            value={value}
            spriteIds={spriteIds}
            spriteFieldKey={
              componentName === "Sprite" && field.key === "imageId"
            }
            animationNames={animationNames}
            onChange={onChange}
          />
        </PropertyRow>
      );
    }
  }
}

// ── RGB ↔ hex helpers (RGB triples are [0,1] floats) ──────────────────

function rgbArrayToHex(rgb: ReadonlyArray<number>): string {
  const toByte = (v: number): string => {
    const clamped = Math.max(0, Math.min(1, v));
    const byte = Math.round(clamped * 255);
    return byte.toString(16).padStart(2, "0");
  };
  return `#${toByte(rgb[0] ?? 0)}${toByte(rgb[1] ?? 0)}${toByte(rgb[2] ?? 0)}`;
}

function hexToRgbArray(
  hex: string,
): [number, number, number] | null {
  let h = hex.trim();
  if (h.startsWith("#")) h = h.slice(1);
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6) return null;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
    return null;
  }
  return [r / 255, g / 255, b / 255];
}

// ── JS-prefab read-only view ──────────────────────────────────────────

function JsPrefabView({
  name,
  path,
  keptAsJs,
  onConvert,
}: {
  name: string;
  path: string;
  keptAsJs: boolean;
  onConvert: () => void;
}) {
  return (
    <ScrollArea className="flex-1 min-h-0">
      <div className="p-6 max-w-2xl mx-auto space-y-4">
        <div className="flex items-center gap-3">
          <Code2 size={24} className="text-amber-400" />
          <div>
            <h2 className="text-base font-semibold text-zinc-100">{name}</h2>
            <p className="text-xs text-zinc-500 font-mono">{path}</p>
          </div>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 text-sm text-zinc-300 leading-relaxed space-y-2">
          <p>
            Registered from{" "}
            <code className="font-mono text-amber-300">{path}</code> via{" "}
            <code className="font-mono">api.registerPrefab</code>.
          </p>
          <p className="text-zinc-400">
            This prefab is authored in JavaScript and edits live in the
            Scripts mode. The Entities tab only round-trips declarative
            prefabs (those stored in{" "}
            <code className="font-mono">manifest.prefabs</code>). The
            converter below can extract statically-resolvable{" "}
            <code className="font-mono">world.add</code> calls into the
            declarative form and route the residual logic into an{" "}
            <code className="font-mono">initScript</code>.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="primary" size="sm" onClick={onConvert}>
            Convert to declarative
          </Button>
          {keptAsJs ? (
            <Badge variant="zinc">
              You previously chose to keep this prefab as JS.
            </Badge>
          ) : null}
        </div>
      </div>
    </ScrollArea>
  );
}

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Find JS prefabs referenced by legacy `manifest.scripts[]` entries.
 *
 * Post-WORLD_STATE "world.json full-scope" (2026-05-17) the field is
 * gone from `PackManifest`; scripts now live in `world.json.scripts[]`
 * and are loaded by `Game.runPackScripts` directly. The detector is
 * kept as a no-op so the JS→declarative converter UI still mounts —
 * scenes the editor opens today never surface JS prefabs because the
 * registerPrefab() flow was removed alongside `manifest.scripts`.
 */
async function detectJsPrefabs(
  _projectId: string,
  _manifest: PackManifest | null,
): Promise<ReadonlyArray<{ name: string; scriptPath: string }>> {
  return [];
}

function cloneJson<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/* ────────────────────────────────────────────────────────────────────
 * Phase #196 — JS→declarative converter UI (preserved verbatim;
 * R4c keeps the existing modal unchanged — the converter logic is
 * outside the scope of the visual re-skin).
 * ──────────────────────────────────────────────────────────────────── */

const KEEP_AS_JS_PATH = "__editor__/prefab-keep-as-js.json";

async function loadKeepAsJs(projectId: string): Promise<Set<string>> {
  const body = await EditorProjectStore.loadAsset(projectId, KEEP_AS_JS_PATH);
  if (typeof body !== "string") return new Set();
  try {
    const arr = JSON.parse(body) as ReadonlyArray<string>;
    return new Set(arr);
  } catch {
    return new Set();
  }
}

async function saveKeepAsJs(
  projectId: string,
  set: ReadonlySet<string>,
): Promise<void> {
  const arr = [...set].sort();
  await EditorProjectStore.saveAsset(
    projectId,
    KEEP_AS_JS_PATH,
    JSON.stringify(arr, null, 2),
  );
}

function PrefabConverterModal({
  projectId,
  name,
  scriptPath,
  manifest,
  onCancel,
  onApplied,
}: {
  projectId: string;
  name: string;
  scriptPath: string;
  manifest: PackManifest | null;
  onCancel: () => void;
  onApplied: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<string>("");
  const [result, setResult] = useState<PrefabConversionResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const body = await EditorProjectStore.loadAsset(projectId, scriptPath);
        if (typeof body !== "string") {
          setParseError(`Could not load ${scriptPath}.`);
          return;
        }
        const mod = await import("../lib/prefabConverter");
        if (cancelled) return;
        setSource(body);
        const file = await mod.parsePrefabFile(scriptPath, body);
        if (file.parseError) {
          setParseError(file.parseError);
          return;
        }
        const match = file.prefabs.find((p) => p.name === name);
        if (!match) {
          setParseError(
            `No registerPrefab("${name}", ...) call found in ${scriptPath}.`,
          );
          return;
        }
        setResult(match);
        const o: Record<string, boolean> = {};
        for (const c of match.calls) {
          if (c.extractable) o[c.componentName] = true;
        }
        setOverrides(o);
      } catch (err) {
        setParseError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, name, scriptPath]);

  const preview = useMemo(() => {
    if (!result) return null;
    const staticComponents: Record<string, unknown> = {};
    const residualLines: string[] = [];
    for (const c of result.calls) {
      const extract = c.extractable && (overrides[c.componentName] ?? true);
      if (extract && c.staticValue !== undefined) {
        staticComponents[c.componentName] = c.staticValue;
      } else if (c.extractable && c.staticValue !== undefined) {
        residualLines.push(
          `  world.add(entity, C.${c.componentName}, ${JSON.stringify(c.staticValue)});`,
        );
      } else {
        residualLines.push(c.residualSource);
      }
    }
    const extracted = Object.keys(staticComponents).length;
    const total = result.totalCalls;
    return {
      staticComponents,
      residualLines: residualLines.join("\n"),
      extracted,
      total,
    };
  }, [result, overrides]);

  const handleApply = async () => {
    if (!result || !preview || !manifest) return;
    setApplying(true);
    setApplyError(null);
    try {
      const mod = await import("../lib/prefabConverter");
      const initBody = mod.serializeInitScript({
        ...result,
        staticComponents: preview.staticComponents,
        residualBody: preview.residualLines,
      });
      const initPath = mod.prefabInitScriptPath(name);
      const newPrefab: DeclarativePrefab = {
        name,
        components: preview.staticComponents,
      };
      if (preview.residualLines.trim().length > 0) {
        // `initScript` was deprecated by PREFABS_EDITOR_ONLY (#290) and
        // removed from the `DeclarativePrefab` type. The converter UI
        // is preserved verbatim for legacy JS-prefab round-trips — the
        // residual init body still gets written to disk so authors can
        // fold the leftover logic into a Systems component manually.
        (newPrefab as DeclarativePrefab & { initScript?: string }).initScript =
          initPath;
        await EditorProjectStore.saveAsset(projectId, initPath, initBody);
      }
      // `manifest.scripts[]` was removed in WORLD_STATE "world.json
      // full-scope" — script lists now live in `world.json.scripts[]`.
      // The converter no longer prunes a manifest list; if a pack has
      // a stale `scripts` array on disk the editor's manifest reader
      // drops the unknown field on its next save round-trip.
      const nextManifest: PackManifest = {
        ...manifest,
        prefabs: {
          ...(manifest.prefabs ?? {}),
          [name]: newPrefab,
        },
      };
      void scriptPath;
      await EditorProjectStore.saveManifest(projectId, nextManifest);
      const keep = await loadKeepAsJs(projectId);
      keep.delete(name);
      await saveKeepAsJs(projectId, keep);
      onApplied();
    } catch (err) {
      setApplyError((err as Error).message);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="bg-zinc-950 border border-zinc-800 rounded-lg w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden">
        <header className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">
              Convert JS prefab → declarative
            </h2>
            <p className="text-[11px] text-zinc-500 font-mono">
              {name} · {scriptPath}
            </p>
          </div>
          <button
            className="text-zinc-400 hover:text-zinc-100 text-lg leading-none px-2"
            onClick={onCancel}
            title="Cancel"
          >
            ✕
          </button>
        </header>
        <div className="flex-1 overflow-auto p-4 grid grid-cols-2 gap-4 min-h-0">
          <section className="border border-zinc-800 rounded bg-zinc-950/40 flex flex-col min-h-0">
            <div className="px-3 py-2 border-b border-zinc-800 text-[11px] uppercase tracking-wide text-zinc-400">
              Original — {scriptPath}
            </div>
            <pre className="flex-1 overflow-auto p-3 text-[11px] font-mono text-zinc-300 whitespace-pre-wrap leading-relaxed">
              {loading ? "Loading…" : source}
            </pre>
          </section>
          <section className="border border-zinc-800 rounded bg-zinc-950/40 flex flex-col min-h-0">
            <div className="px-3 py-2 border-b border-zinc-800 text-[11px] uppercase tracking-wide text-zinc-400 flex items-center justify-between">
              <span>Converted</span>
              {preview ? (
                <span className="text-zinc-500">
                  {preview.extracted} / {preview.total} extracted
                </span>
              ) : null}
            </div>
            <div className="flex-1 overflow-auto p-3 text-[11px] font-mono text-zinc-300 space-y-3">
              {parseError ? (
                <div className="text-red-300 bg-red-900/30 border border-red-700 rounded p-2 font-sans text-xs">
                  Parse error: {parseError}
                </div>
              ) : null}
              {result?.tooDynamic && preview?.extracted === 0 ? (
                <div className="text-amber-200 bg-amber-900/30 border border-amber-700 rounded p-2 font-sans text-xs">
                  0 of {result.totalCalls} components extractable — this
                  prefab is too dynamic. Keep as JS, or rewrite some
                  values as literals.
                </div>
              ) : null}
              {result ? (
                <>
                  <div className="font-sans text-zinc-400 text-[11px]">
                    Component overrides
                  </div>
                  <ul className="space-y-1 font-sans text-xs">
                    {result.calls.map((c, i) => (
                      <li
                        key={`${c.componentName}-${i}`}
                        className="flex items-center gap-2"
                      >
                        <input
                          type="checkbox"
                          disabled={!c.extractable}
                          checked={
                            c.extractable
                              ? (overrides[c.componentName] ?? true)
                              : false
                          }
                          onChange={(e) =>
                            setOverrides((prev) => ({
                              ...prev,
                              [c.componentName]: e.target.checked,
                            }))
                          }
                          title={
                            c.extractable
                              ? "Toggle off to keep this in the init script"
                              : (c.reason ?? "Not statically extractable")
                          }
                        />
                        <code>{c.componentName}</code>
                        {c.extractable ? (
                          <span className="text-zinc-500 text-[10px]">
                            extractable
                          </span>
                        ) : (
                          <span className="text-amber-400 text-[10px]">
                            dynamic — {c.reason}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                  <div className="font-sans text-zinc-400 text-[11px] pt-2">
                    manifest.prefabs.{name}
                  </div>
                  <pre className="bg-zinc-900/60 border border-zinc-800 rounded p-2 overflow-auto">
                    {JSON.stringify(
                      {
                        name,
                        components: preview?.staticComponents ?? {},
                        ...(preview && preview.residualLines.trim().length > 0
                          ? { initScript: `scripts/prefabs/${name}-init.js` }
                          : {}),
                      },
                      null,
                      2,
                    )}
                  </pre>
                  {preview && preview.residualLines.trim().length > 0 ? (
                    <>
                      <div className="font-sans text-zinc-400 text-[11px] pt-2">
                        scripts/prefabs/{name}-init.js (NEW)
                      </div>
                      <pre className="bg-zinc-900/60 border border-zinc-800 rounded p-2 overflow-auto">
                        {preview.residualLines}
                      </pre>
                    </>
                  ) : null}
                </>
              ) : null}
            </div>
          </section>
        </div>
        <footer className="px-4 py-3 border-t border-zinc-800 flex items-center justify-between gap-2">
          {applyError ? (
            <div className="text-xs text-red-300">{applyError}</div>
          ) : (
            <p className="text-[11px] text-zinc-500">
              Apply rewrites the manifest and writes the init script
              asset (if any residual). Removing the original JS from
              <code> world.json.scripts</code> is a follow-up task.
            </p>
          )}
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={
                applying ||
                !result ||
                !preview ||
                preview.extracted === 0 ||
                !!parseError
              }
              onClick={handleApply}
            >
              {applying ? "Applying…" : "Apply"}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}
