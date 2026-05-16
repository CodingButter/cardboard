import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type {
  DeclarativePrefab,
  PackManifest,
} from "@two_5_d/engine";
import { EditorProjectStore } from "../lib/EditorProjectStore";
import {
  ComponentSubform,
} from "../components/ComponentForm";
import {
  BUILT_IN_COMPONENT_SCHEMAS,
  findComponentSchema,
} from "../lib/componentSchemas";
import { Button, Input, Label, Textarea } from "../components/ui";
import { cn } from "../lib/cn";

/**
 * E-ENT — Entities workflow tab. EDITOR.md §6.3.
 *
 * Declarative prefab authoring. The user composes a prefab from
 * components (Position, Sprite, Light, ...) by filling schema-driven
 * forms; on save the prefab lands in `manifest.prefabs[id]` and the
 * engine's `registerDeclarativePrefabs` walks that block at boot to
 * register the prefab via the same `api.registerPrefab` path the
 * JS-based prefabs (e.g. `default-pack/scripts/prefabs/player.js`)
 * use. Editor-authored prefabs coexist with JS-authored ones — the
 * left rail lists both, but JS prefabs are read-only (the editor
 * can't safely round-trip arbitrary JS).
 *
 * Layout:
 *   ┌──────────────┬─────────────────────────────────┬──────────────┐
 *   │ Prefab list  │ Schema-driven prefab editor     │ JSON preview │
 *   │ + New        │  name + tags + description      │ + Save       │
 *   │              │  + add component                │              │
 *   │              │  + per-component schema form    │              │
 *   └──────────────┴─────────────────────────────────┴──────────────┘
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

/** Regex that picks up `api.registerPrefab("name", ...)` and `.registerPrefab('name', …)`. */
const REGISTER_PREFAB_RE = /registerPrefab\s*\(\s*["']([^"']+)["']/g;

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

  const refresh = useCallback(async () => {
    setError(null);
    const mf = await EditorProjectStore.loadManifest(projectId);
    setManifest(mf);
    setDraft({ ...(mf?.prefabs ?? {}) });
    setDirty(false);
    // Detect JS-based prefabs by scanning script bodies.
    const detected = await detectJsPrefabs(projectId, mf);
    setJsPrefabs(detected);
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

  const addComponent = (compName: string) => {
    patchActive((cur) => {
      if (cur.components[compName]) return cur;
      const schema = findComponentSchema(compName);
      const defaultData = schema
        ? cloneJson(schema.defaultData)
        : ({} as Record<string, unknown>);
      return {
        ...cur,
        components: { ...cur.components, [compName]: defaultData },
      };
    });
  };

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
          // The iframe accepts `reset` and reloads the engine; per
          // `apps/game/src/editor-bridge.ts` that's the simplest path
          // to pick up new declarative prefabs. The editor doesn't
          // own the iframe — broadcast to every same-origin frame.
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

  // ── Sprite ids for the Sprite component's `imageId` dropdown ──
  const spriteIds = useMemo<ReadonlyArray<string>>(() => {
    if (!manifest?.sprites) return [];
    return Object.keys(manifest.sprites).sort();
  }, [manifest]);

  // ── JSON preview ──
  const jsonPreview = useMemo(() => {
    if (!activeRow || activeRow.kind !== "declarative") return "";
    return JSON.stringify(activeRow.data, null, 2);
  }, [activeRow]);

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className="flex h-full min-h-[640px]">
      {/* Left rail: prefab list. */}
      <aside className="w-64 border-r border-zinc-800 bg-zinc-950/40 flex flex-col">
        <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-zinc-400">
            Prefabs
          </span>
          <Button
            variant="primary"
            size="sm"
            onClick={handleNewPrefab}
            title="Create a new declarative prefab"
          >
            + New
          </Button>
        </div>
        <ul className="flex-1 overflow-auto">
          {declarativeRows.length === 0 && jsRows.length === 0 ? (
            <li className="px-4 py-3 text-xs text-zinc-500">
              No prefabs yet. Click "+ New" to author one.
            </li>
          ) : null}
          {declarativeRows.map((row) => (
            <li
              key={`d:${row.name}`}
              className={cn(
                "px-4 py-2 cursor-pointer hover:bg-zinc-800/40 border-b border-zinc-900/60 flex items-center justify-between gap-2",
                activeId === row.name && "bg-zinc-800/60",
              )}
              onClick={() => setActiveId(row.name)}
            >
              <div className="min-w-0">
                <div className="text-sm text-zinc-100 truncate">{row.name}</div>
                <div className="text-[10px] text-zinc-500">
                  {Object.keys(row.data?.components ?? {}).length} component
                  {Object.keys(row.data?.components ?? {}).length === 1
                    ? ""
                    : "s"}
                  {row.data?.tags && row.data.tags.length > 0
                    ? ` · ${row.data.tags.join(", ")}`
                    : null}
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete prefab "${row.name}"?`)) {
                    handleDelete(row.name);
                  }
                }}
                className="text-[10px] text-zinc-500 hover:text-red-400 px-1"
                title="Delete prefab"
              >
                ✕
              </button>
            </li>
          ))}
          {jsRows.length > 0 ? (
            <li className="px-4 py-2 text-[10px] uppercase tracking-wide text-zinc-500 border-y border-zinc-900/60">
              From scripts (read-only)
            </li>
          ) : null}
          {jsRows.map((row) => (
            <li
              key={`j:${row.scriptPath}:${row.name}`}
              className={cn(
                "px-4 py-2 cursor-pointer hover:bg-zinc-800/40 border-b border-zinc-900/60",
                activeId === row.name && "bg-zinc-800/60",
              )}
              onClick={() => setActiveId(row.name)}
              title={row.scriptPath}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm text-zinc-100 truncate">{row.name}</div>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">
                  JS
                </span>
              </div>
              <div className="text-[10px] text-zinc-500 truncate font-mono">
                {row.scriptPath}
              </div>
            </li>
          ))}
        </ul>
      </aside>

      {/* Center: prefab editor. */}
      <section className="flex-1 overflow-auto bg-zinc-950/20">
        {activeRow ? (
          activeRow.kind === "declarative" ? (
            <DeclarativeForm
              prefab={activeRow.data!}
              spriteIds={spriteIds}
              onRename={(next) => handleRename(activeRow.name, next)}
              onSetDescription={(d) =>
                patchActive((cur) => ({ ...cur, description: d || undefined }))
              }
              onSetTags={(t) => patchActive((cur) => ({ ...cur, tags: t }))}
              onAddComponent={addComponent}
              onRemoveComponent={removeComponent}
              onPatchComponent={patchComponentData}
            />
          ) : (
            <JsPrefabView name={activeRow.name} path={activeRow.scriptPath!} />
          )
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-zinc-500">
            Pick a prefab on the left, or click "+ New" to author one.
          </div>
        )}
      </section>

      {/* Right: JSON preview + Save. */}
      <aside className="w-96 border-l border-zinc-800 bg-zinc-950/40 overflow-auto p-4 flex flex-col gap-3">
        <div>
          <h3 className="text-xs uppercase tracking-wide text-zinc-400 mb-2">
            JSON preview
          </h3>
          {activeRow?.kind === "declarative" ? (
            <pre className="text-[10px] bg-zinc-950 border border-zinc-800 rounded-md p-2 overflow-auto max-h-[420px] font-mono text-zinc-300">
              {jsonPreview || "{}"}
            </pre>
          ) : (
            <p className="text-xs text-zinc-500">
              {activeRow?.kind === "js"
                ? "JS prefabs aren't editable from this pane — open the script in the Scripts tab."
                : "Select a prefab to preview its manifest entry."}
            </p>
          )}
        </div>

        {error ? (
          <div className="text-xs text-red-300 bg-red-900/30 border border-red-700 rounded px-2 py-1">
            {error}
          </div>
        ) : null}

        <div className="space-y-2 mt-auto">
          {savedAt ? (
            <p className="text-xs text-emerald-400">
              Saved {new Date(savedAt).toLocaleTimeString()}
            </p>
          ) : dirty ? (
            <p className="text-xs text-amber-400">Unsaved changes</p>
          ) : null}
          <Button
            variant="primary"
            className="w-full"
            disabled={saving || !dirty || !manifest}
            onClick={() => handleSave(false)}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button
            variant="secondary"
            className="w-full"
            disabled={saving || !manifest}
            onClick={() => handleSave(true)}
            title="Save and reload the engine in Play mode so the new prefab is spawnable"
          >
            Save & Test
          </Button>
          <p className="text-[10px] text-zinc-500 leading-relaxed">
            Prefabs land in <code>manifest.prefabs</code>. The engine
            registers them via <code>api.registerPrefab</code> at boot;
            scripts call <code>api.spawn("id", opts)</code> to instance.
          </p>
        </div>
      </aside>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────

/** Center pane — the schema-driven editor for one declarative prefab. */
function DeclarativeForm({
  prefab,
  spriteIds,
  onRename,
  onSetDescription,
  onSetTags,
  onAddComponent,
  onRemoveComponent,
  onPatchComponent,
}: {
  prefab: DeclarativePrefab;
  spriteIds: ReadonlyArray<string>;
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

  return (
    <div className="p-4 space-y-4 max-w-2xl mx-auto">
      <section>
        <Label htmlFor="ent-name">Name</Label>
        <Input
          id="ent-name"
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={() => {
            const trimmed = nameDraft.trim();
            if (trimmed && trimmed !== prefab.name) onRename(trimmed);
            else setNameDraft(prefab.name);
          }}
          placeholder="zombie"
          className="font-mono mt-1"
        />
        <p className="text-[11px] text-zinc-500 mt-1">
          Prefab id — same as the manifest record key. Used by{" "}
          <code>api.spawn("&lt;name&gt;", opts)</code>.
        </p>
      </section>
      <section>
        <Label htmlFor="ent-desc">Description</Label>
        <Textarea
          id="ent-desc"
          value={prefab.description ?? ""}
          onChange={(e) => onSetDescription(e.target.value)}
          placeholder="Optional — shown in the prefab list."
          rows={2}
          className="mt-1"
        />
      </section>
      <section>
        <Label htmlFor="ent-tags">Tags</Label>
        <Input
          id="ent-tags"
          value={(prefab.tags ?? []).join(", ")}
          onChange={(e) => {
            const parts = e.target.value
              .split(",")
              .map((p) => p.trim())
              .filter((p) => p.length > 0);
            onSetTags(parts);
          }}
          placeholder="enemy, undead"
          className="mt-1"
        />
        <p className="text-[11px] text-zinc-500 mt-1">
          Comma-separated. Used for filtering in the prefab list.
        </p>
      </section>

      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs uppercase tracking-wide text-zinc-400">
            Components
          </h3>
          {availableToAdd.length > 0 ? (
            <select
              onChange={(e) => {
                const v = e.target.value;
                if (v) {
                  onAddComponent(v);
                  e.target.value = "";
                }
              }}
              className="h-7 rounded border border-zinc-700 bg-zinc-900 px-2 text-[11px]"
              defaultValue=""
            >
              <option value="" disabled>
                + add component…
              </option>
              {availableToAdd.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-[11px] text-zinc-500">
              every built-in attached
            </span>
          )}
        </div>
        {presentComponents.length === 0 ? (
          <div className="text-xs text-zinc-500 border border-dashed border-zinc-800 rounded p-3">
            No components yet. Pick one above — Position + Sprite +
            optional Light is a typical entity recipe.
          </div>
        ) : (
          <div className="space-y-3 text-xs">
            {presentComponents.map((name) => (
              <ComponentSubform
                key={name}
                name={name}
                data={prefab.components[name] as Record<string, unknown>}
                spriteIds={spriteIds}
                onPatch={(next) => onPatchComponent(name, next)}
                onRemove={() => onRemoveComponent(name)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/** Read-only stub shown for JS-detected prefabs. */
function JsPrefabView({ name, path }: { name: string; path: string }) {
  return (
    <div className="p-4 max-w-2xl mx-auto text-sm space-y-3">
      <h2 className="text-base font-semibold text-zinc-100">{name}</h2>
      <div className="text-xs text-zinc-500">
        Registered from <code className="font-mono">{path}</code> via{" "}
        <code>api.registerPrefab</code>.
      </div>
      <div className="text-xs text-zinc-300 rounded border border-zinc-800 bg-zinc-950/50 p-3 leading-relaxed">
        This prefab is authored in JavaScript and edits live in the
        Scripts mode. The Entities tab only round-trips declarative
        prefabs (those stored in <code>manifest.prefabs</code>). To
        rewrite a JS prefab as declarative: copy the relevant
        component data into a new declarative prefab here, then
        delete the script registration. Both kinds coexist at
        runtime — the later registration wins on name collision.
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Find JS prefabs referenced by `manifest.scripts[]`. Each script body
 * is scanned for `registerPrefab("name", …)` / `registerPrefab('name', …)`
 * calls; the first match per script wins. Returns an empty list when
 * the project has no scripts or none of them register a prefab.
 */
async function detectJsPrefabs(
  projectId: string,
  manifest: PackManifest | null,
): Promise<ReadonlyArray<{ name: string; scriptPath: string }>> {
  if (!manifest?.scripts || manifest.scripts.length === 0) return [];
  const out: { name: string; scriptPath: string }[] = [];
  const seen = new Set<string>();
  for (const path of manifest.scripts) {
    const body = await EditorProjectStore.loadAsset(projectId, path);
    if (typeof body !== "string") continue;
    REGISTER_PREFAB_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = REGISTER_PREFAB_RE.exec(body)) !== null) {
      const name = m[1]!;
      if (seen.has(name)) continue;
      seen.add(name);
      out.push({ name, scriptPath: path });
    }
  }
  return out;
}

function cloneJson<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
