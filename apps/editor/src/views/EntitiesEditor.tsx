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
import type { SpriteDef } from "@two_5_d/engine/AssetPack";
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
import type { PrefabConversionResult } from "../lib/prefabConverter";
import {
  buildAnimationComponentFromSuggestion,
  computeAnimationWiringState,
} from "../lib/prefabAnimationWiring";

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
  /**
   * Phase #196 — converter modal open state. When non-null, the modal
   * is open against the named JS prefab + script path. Set via the
   * "Convert to declarative" button on a JS-prefab row.
   */
  const [converterTarget, setConverterTarget] = useState<
    { name: string; scriptPath: string } | null
  >(null);
  /**
   * Per-project "keep as JS" set — the converter writes a hidden asset
   * row at `__editor__/prefab-keep-as-js.json` recording every prefab
   * the user chose to leave alone. Drives the "JS" badge suppression
   * after a cancel.
   */
  const [keepAsJs, setKeepAsJs] = useState<ReadonlySet<string>>(new Set());

  const refresh = useCallback(async () => {
    setError(null);
    const mf = await EditorProjectStore.loadManifest(projectId);
    setManifest(mf);
    setDraft({ ...(mf?.prefabs ?? {}) });
    setDirty(false);
    // Detect JS-based prefabs by scanning script bodies.
    const detected = await detectJsPrefabs(projectId, mf);
    setJsPrefabs(detected);
    // Pull the "keep as JS" suppression list.
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

  /**
   * Manifest's sprites dict — handed to the prefab form so the
   * Animation auto-wire prompt + the `current` dropdown can resolve
   * animation names from `Sprite.imageId`. Memoized so the form's
   * `useMemo` lookups don't re-run on unrelated state changes.
   */
  const spritesById = useMemo<Readonly<Record<string, SpriteDef>>>(() => {
    return manifest?.sprites ?? {};
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
                {keepAsJs.has(row.name) ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">
                    JS·kept
                  </span>
                ) : (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/60 text-amber-200">
                    JS
                  </span>
                )}
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
              spritesById={spritesById}
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
      {converterTarget ? (
        <PrefabConverterModal
          projectId={projectId}
          name={converterTarget.name}
          scriptPath={converterTarget.scriptPath}
          manifest={manifest}
          onCancel={async () => {
            // Per Phase #196 B4 — record the cancel so the JS badge
            // stops nagging on subsequent loads. The user opted out
            // deliberately; we respect that until they manually
            // re-open the converter from the JS prefab view.
            const next = new Set(keepAsJs);
            next.add(converterTarget.name);
            setKeepAsJs(next);
            await saveKeepAsJs(projectId, next);
            setConverterTarget(null);
          }}
          onApplied={async () => {
            setConverterTarget(null);
            // Refresh so the new declarative prefab appears in the
            // left rail and the JS row vanishes.
            await refresh();
          }}
        />
      ) : null}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────

/** Center pane — the schema-driven editor for one declarative prefab. */
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

  // ── Animation auto-wire context ────────────────────────────────
  //
  // Pure analysis of the prefab vs. the manifest's sprite dict —
  // surfaces a suggestion when the prefab has a sheet-based Sprite
  // but no Animation component, and a mismatch warning when an
  // Animation component points at an animation the sprite doesn't
  // define. Same helper the smoke test runs against.
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

  /**
   * Wire the inline "+ Add Animation component" button to the same
   * addComponent path the picker uses, then patch `current` to the
   * first animation name so the modder lands in a runnable state.
   */
  const addAnimationFromSuggestion = () => {
    const payload = buildAnimationComponentFromSuggestion(
      spriteAnimationNames,
    );
    if (!payload) return;
    onAddComponent("Animation");
    onPatchComponent("Animation", payload);
  };

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
            {presentComponents.map((name) => {
              // Component-specific header: under Sprite, surface the
              // "this sprite has animations → add an Animation
              // component" prompt. Under Animation, surface the
              // mismatch warning when the sprite no longer offers
              // the chosen animation.
              let header: React.ReactNode = null;
              if (name === "Sprite" && suggestAnimation) {
                header = (
                  <div
                    data-testid="anim-suggestion"
                    className="rounded border border-amber-700/60 bg-amber-900/20 p-2 text-[11px] text-amber-200 flex items-center justify-between gap-2"
                  >
                    <span>
                      ⚡ This sprite has {spriteAnimationNames.length}{" "}
                      animation
                      {spriteAnimationNames.length === 1 ? "" : "s"}
                      {" "}defined.
                    </span>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={addAnimationFromSuggestion}
                      title="Add an Animation component pre-filled with the first animation"
                    >
                      + Add Animation component
                    </Button>
                  </div>
                );
              } else if (name === "Animation" && animationMismatch) {
                header = (
                  <div className="rounded border border-amber-700/60 bg-amber-900/20 p-2 text-[11px] text-amber-200">
                    {spriteAnimationNames.length === 0
                      ? `No Sprite component (or imageId points at a sprite without animations) — the Animation component is inert.`
                      : `current = "${animationCurrent}" is not in the sprite's animations: ${spriteAnimationNames.join(", ")}.`}
                  </div>
                );
              }
              return (
                <ComponentSubform
                  key={name}
                  name={name}
                  data={prefab.components[name] as Record<string, unknown>}
                  spriteIds={spriteIds}
                  // Only the Animation subform consumes animationNames;
                  // passing it everywhere is harmless (the field type
                  // filter inside ComponentField gates the dropdown).
                  animationNames={spriteAnimationNames}
                  header={header}
                  onPatch={(next) => onPatchComponent(name, next)}
                  onRemove={() => onRemoveComponent(name)}
                />
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

/** Read-only stub shown for JS-detected prefabs. */
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
    <div className="p-4 max-w-2xl mx-auto text-sm space-y-3">
      <h2 className="text-base font-semibold text-zinc-100">{name}</h2>
      <div className="text-xs text-zinc-500">
        Registered from <code className="font-mono">{path}</code> via{" "}
        <code>api.registerPrefab</code>.
      </div>
      <div className="text-xs text-zinc-300 rounded border border-zinc-800 bg-zinc-950/50 p-3 leading-relaxed">
        This prefab is authored in JavaScript and edits live in the
        Scripts mode. The Entities tab only round-trips declarative
        prefabs (those stored in <code>manifest.prefabs</code>). The
        converter below can extract statically-resolvable
        <code> world.add</code> calls into the declarative form and
        route the residual logic into an <code>initScript</code>.
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          onClick={onConvert}
          title="Run the JS→declarative converter against this prefab"
        >
          Convert to declarative
        </Button>
        {keptAsJs ? (
          <span className="text-[11px] text-zinc-500">
            You previously chose to keep this prefab as JS.
          </span>
        ) : null}
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

/* ────────────────────────────────────────────────────────────────────
 * Phase #196 — JS→declarative converter UI
 * ──────────────────────────────────────────────────────────────────── */

/**
 * Hidden asset slot that stores the "keep as JS" suppression list. Not
 * part of the runtime manifest; lives under `__editor__/` so the pack-
 * builder strips it out of the .apg.
 */
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

/**
 * Modal UI driving the converter. Side-by-side diff:
 *
 *   ┌───────────────────────────┬───────────────────────────┐
 *   │ Original JS source        │ Declarative + init script │
 *   │ scripts/prefabs/zombie.js │ manifest.prefabs.zombie:  │
 *   │ <verbatim>                │ { components: { ... },    │
 *   │                           │   initScript: "..." }     │
 *   │                           │ scripts/prefabs/...-init  │
 *   │                           │ <generated body>          │
 *   └───────────────────────────┴───────────────────────────┘
 *
 * Checkboxes let the user un-extract a component (forcing it back into
 * the residual). Apply writes the new manifest + new asset and removes
 * the original script from `manifest.scripts[]`.
 */
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
        // Lazy-load the converter — keeps Babel out of the editor's
        // main bundle. Same dynamic import the smoke test uses.
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
        // Default to extracting every component the converter flagged
        // as extractable.
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

  // Derive the final declarative `components` map + the residual init
  // script source from the live overrides. Re-run on toggle so the
  // preview updates in real time.
  const preview = useMemo(() => {
    if (!result) return null;
    const staticComponents: Record<string, unknown> = {};
    const residualLines: string[] = [];
    for (const c of result.calls) {
      const extract = c.extractable && (overrides[c.componentName] ?? true);
      if (extract && c.staticValue !== undefined) {
        staticComponents[c.componentName] = c.staticValue;
      } else if (c.extractable && c.staticValue !== undefined) {
        // User explicitly opted out — emit an explicit world.add line
        // into the residual so the runtime behaviour is preserved.
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
        newPrefab.initScript = initPath;
        await EditorProjectStore.saveAsset(projectId, initPath, initBody);
      }
      const nextScripts = (manifest.scripts ?? []).filter(
        (p) => p !== scriptPath,
      );
      const nextManifest: PackManifest = {
        ...manifest,
        prefabs: {
          ...(manifest.prefabs ?? {}),
          [name]: newPrefab,
        },
        ...(nextScripts.length > 0
          ? { scripts: nextScripts }
          : { scripts: undefined }),
      };
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
              Apply rewrites the manifest, writes the init script asset
              (if any residual), and removes the original JS from
              <code> manifest.scripts</code>.
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
