import React from "react";
import { createPortal } from "react-dom";
import { Lock, Plus, Save, MoreVertical } from "lucide-react";
import type { DockviewApi, SerializedDockview } from "dockview";
import { cn } from "../../lib/cn";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Tooltip } from "../ui/Tooltip";
import { LayoutSkeleton } from "./LayoutSkeleton";
import {
  useWorkspaceStore,
  useEditingPresetId,
  type WorkspacePreset,
} from "../../state/useWorkspaceStore";
import { useRegisteredPredefinedLayouts } from "../../state/useLayoutRegistryStore";
import { useCommandStore } from "../../state/useCommandStore";

// Hoisted so the workspace-store selector's fallback reference is
// stable across renders (returning a fresh `[]` per call defeats
// zustand's shallow-equality optimization for unchanged state).
const EMPTY_USER_PRESETS: WorkspacePreset[] = [];

/**
 * LayoutsModal — the Workspace v1.5 layouts surface.
 *
 * Replaces the rail's per-preset icon column with a card grid in a
 * modal. Predefined (built-in) layouts and user-saved presets render
 * in the same grid; built-ins are uneditable (Lock badge) and always
 * appear first. User presets follow after a hairline divider and
 * support hover-kebab / right-click context menus for Rename / Delete
 * inline (reusing the legacy `LayoutPresetButton` semantics).
 *
 * Card click → `api.fromJSON(layout)` + close modal. The active card
 * is highlighted using the workspace store's `lastAppliedPresetId`
 * marker (mirrors which preset/predefined layout was most recently
 * applied for the current page).
 *
 * Save flows:
 *   - "Save current layout as new…"  prompts for a name and writes a
 *     new user preset via `savePreset`.
 *   - "Resave current layout"        overwrites the current active
 *     user preset's layout in place via `resavePreset`. Disabled when
 *     no user preset is active (built-in is current, or nothing
 *     applied yet).
 */

interface LayoutsModalProps {
  open: boolean;
  onClose: () => void;
  /** Page id used to scope predefined + user preset lists. */
  pageId: string;
  /** Live dockview api ref so we can call toJSON / fromJSON. */
  apiRef: React.MutableRefObject<DockviewApi | null>;
}

interface CardBaseProps {
  id: string;
  name: string;
  layout: SerializedDockview;
  active: boolean;
  builtIn?: boolean;
  /** When true, the card mounts in inline-rename mode with the name
   *  input focused and its value selected so the user can immediately
   *  start typing to replace the default. Triggered by the parent
   *  whenever a new preset has just been created. */
  autoEdit?: boolean;
  /** Called when the parent should clear the auto-edit flag (commit /
   *  cancel from the inline editor). */
  onEditEnd?: () => void;
  onClick: () => void;
  onRename?: (next: string) => void;
  onDelete?: () => void;
}

const PRESET_SENTINEL = "[data-layouts-card-menu]";

function LayoutCard({
  id,
  name,
  layout,
  active,
  builtIn,
  autoEdit = false,
  onEditEnd,
  onClick,
  onRename,
  onDelete,
}: CardBaseProps): React.JSX.Element {
  const [menu, setMenu] = React.useState<
    | { kind: "closed" }
    | { kind: "open"; x: number; y: number }
    | { kind: "confirm-delete" }
  >({ kind: "closed" });
  const [editing, setEditing] = React.useState<boolean>(autoEdit);
  const [renameValue, setRenameValue] = React.useState(name);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  // Mirror the auto-edit prop on transition false→true so a preset
  // re-edited from the parent (e.g. Rename via kebab) lands in edit
  // mode without re-mounting the card.
  React.useEffect(() => {
    if (autoEdit) {
      setEditing(true);
      setRenameValue(name);
    }
  }, [autoEdit, name]);

  React.useEffect(() => setRenameValue(name), [name]);

  // Auto-focus + select-all when entering edit mode so the user can
  // immediately start typing to replace the placeholder.
  React.useEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [editing]);

  const menuOpen = menu.kind !== "closed";

  React.useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest(PRESET_SENTINEL)) return;
      setMenu({ kind: "closed" });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Stop propagation so the parent LayoutsModal's window-level
        // Esc handler doesn't dismiss the entire modal alongside the
        // inner confirm/menu — one Esc should peel one layer.
        e.stopPropagation();
        setMenu({ kind: "closed" });
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const openMenu = (x: number, y: number) => setMenu({ kind: "open", x, y });

  const onContextMenu = (e: React.MouseEvent) => {
    if (builtIn) return;
    e.preventDefault();
    openMenu(e.clientX, e.clientY);
  };

  const onKebabClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    openMenu(rect.left, rect.bottom + 4);
  };

  const commitRename = () => {
    const next = renameValue.trim();
    if (next && next !== name) {
      onRename?.(next);
    }
    setEditing(false);
    onEditEnd?.();
  };

  const cancelRename = () => {
    setRenameValue(name);
    setEditing(false);
    onEditEnd?.();
  };

  const startInlineRename = () => {
    setMenu({ kind: "closed" });
    setRenameValue(name);
    setEditing(true);
  };

  return (
    <>
      <Tooltip
        stages={[
          { delay: 1000, content: <span>{name}</span> },
          {
            delay: 3000,
            content: (
              <div>
                <div className="font-semibold">{name}</div>
                <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                  {builtIn
                    ? `Built-in workspace layout. Click to apply ${name} to the current page. Built-ins can't be edited or deleted.`
                    : `Saved workspace preset. Click to restore this layout. Right-click or use the kebab menu to rename or delete.`}
                </div>
              </div>
            ),
          },
        ]}
      >
      <button
        type="button"
        data-layouts-card={id}
        data-active={active ? "true" : "false"}
        onClick={editing ? undefined : onClick}
        onContextMenu={onContextMenu}
        className={cn(
          "group relative flex flex-col gap-2 rounded-md border p-3 text-left",
          "transition-colors hover:shadow-[var(--shadow-panel)]",
          active
            ? "ring-1 ring-(--color-accent) border-(--color-accent) bg-(--color-bg-card)"
            : "border-(--color-border) hover:border-(--color-border-strong) bg-(--color-bg-card)",
        )}
      >
        {/* Thumbnail */}
        <div
          className={cn(
            "w-full h-[120px] rounded border border-(--color-border)",
            "bg-(--color-bg-app) p-1.5 overflow-hidden",
          )}
        >
          <LayoutSkeleton layout={layout} />
        </div>
        {/* Footer row: name + badges. When `editing` is true the name
            cell flips to an inline input with autoFocus + select-all;
            commits on Enter or blur, cancels on Escape. */}
        <div className="flex items-center gap-1.5 min-w-0">
          {editing ? (
            <input
              ref={inputRef}
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitRename();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancelRename();
                }
              }}
              onBlur={commitRename}
              className={cn(
                "flex-1 min-w-0 px-1.5 py-0.5 text-[12px] rounded outline-none",
                "bg-(--color-bg-card-elev) border border-(--color-accent)",
                "text-(--color-fg-primary)",
              )}
            />
          ) : (
            <span
              className={cn(
                "flex-1 truncate text-[13px] font-medium",
                active
                  ? "text-(--color-fg-primary)"
                  : "text-(--color-fg-secondary)",
              )}
            >
              {name}
            </span>
          )}
          {builtIn ? (
            <Lock
              size={12}
              aria-label="Built-in layout"
              className="text-(--color-fg-muted) shrink-0"
            />
          ) : null}
          {!builtIn ? (
            <Tooltip
              stages={[
                { delay: 1000, content: <span>More actions</span> },
                {
                  delay: 3000,
                  content: (
                    <div>
                      <div className="font-semibold">More actions</div>
                      <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                        Rename or delete the {name} preset. Right-clicking the
                        card also opens this menu.
                      </div>
                    </div>
                  ),
                },
              ]}
            >
            <span
              role="button"
              tabIndex={0}
              onClick={onKebabClick}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  const rect = (
                    e.currentTarget as HTMLElement
                  ).getBoundingClientRect();
                  openMenu(rect.left, rect.bottom + 4);
                }
              }}
              className={cn(
                "shrink-0 h-5 w-5 rounded flex items-center justify-center",
                "text-(--color-fg-muted) hover:text-(--color-fg-primary)",
                "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                "transition-opacity",
              )}
              aria-label={`More actions for ${name}`}
            >
              <MoreVertical size={14} />
            </span>
            </Tooltip>
          ) : null}
        </div>
      </button>
      </Tooltip>

      {menu.kind === "confirm-delete"
        ? createPortal(
            <div
              data-layouts-card-menu
              className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50"
              onClick={() => setMenu({ kind: "closed" })}
            >
              <div
                className={cn(
                  "card-surface-elev px-4 py-3 rounded border min-w-[260px]",
                  "border-red-500/40 flex flex-col gap-2",
                  "bg-(--color-bg-card-elev)",
                )}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="text-sm text-(--color-fg-primary)">
                  Delete <span className="font-medium">{name}</span>?
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setMenu({ kind: "closed" })}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      onDelete?.();
                      setMenu({ kind: "closed" });
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {menu.kind === "open"
        ? createPortal(
            <div
              data-layouts-card-menu
              style={{
                position: "fixed",
                left: menu.x,
                top: menu.y,
                zIndex: 10000,
              }}
              className={cn(
                "card-surface-elev rounded border min-w-[140px]",
                "border-(--color-border-strong) bg-(--color-bg-card-elev) py-1",
              )}
            >
              <button
                type="button"
                className="w-full text-left px-3 py-1.5 text-[12px] text-(--color-fg-primary) hover:bg-(--color-bg-hover)"
                onClick={startInlineRename}
              >
                Rename
              </button>
              <button
                type="button"
                className="w-full text-left px-3 py-1.5 text-[12px] text-red-300 hover:bg-red-500/10"
                onClick={() => setMenu({ kind: "confirm-delete" })}
              >
                Delete
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export function LayoutsModal({
  open,
  onClose,
  pageId,
  apiRef,
}: LayoutsModalProps): React.JSX.Element {
  // P5 — predefined layouts come from the pack-contributed registry
  // (`useLayoutRegistryStore`). The hook returns a stable array that
  // re-derives only when the registry changes, so the LayoutsModal
  // grid keys stay consistent across renders.
  const predefined = useRegisteredPredefinedLayouts(pageId);

  const presets = useWorkspaceStore(
    (s) => s.presets[pageId] ?? EMPTY_USER_PRESETS,
  );
  const lastAppliedPresetId = useWorkspaceStore(
    (s) => s.lastAppliedPresetId[pageId] ?? null,
  );
  const renamePreset = useWorkspaceStore((s) => s.renamePreset);
  const deletePreset = useWorkspaceStore((s) => s.deletePreset);
  const resavePreset = useWorkspaceStore((s) => s.resavePreset);
  const setLastAppliedPresetId = useWorkspaceStore(
    (s) => s.setLastAppliedPresetId,
  );
  const clearEditingPresetId = useWorkspaceStore(
    (s) => s.clearEditingPresetId,
  );

  // Inline-rename target is owned by the workspace store now — the
  // palette-driven `layouts.saveAsNew` command writes here from outside
  // the modal, and this component just reads + clears.
  const editingPresetId = useEditingPresetId(pageId);

  const activeUserPreset = React.useMemo(
    () => presets.find((p) => p.id === lastAppliedPresetId) ?? null,
    [presets, lastAppliedPresetId],
  );

  // ── Matched-preset tracking ────────────────────────────────────────
  //
  // Whenever the user adjusts the live dockview layout (drags a panel,
  // resizes a splitter, opens a popout, etc.), we re-compare the
  // current api.toJSON() against every preset's stored layout and
  // record which preset (if any) the current layout exactly matches.
  //
  //   - matchedPresetId === <some id>  → highlight that card, disable
  //     "Save Current as New" (no point creating a duplicate of an
  //     existing layout).
  //   - matchedPresetId === null       → no card highlighted (the
  //     user deviated from every saved layout), and "Save Current as
  //     New" is enabled.
  //
  //   - "Resave Current" stays bound to `lastAppliedPresetId` (sticky
  //     — doesn't change on edits) AND is only enabled when the
  //     current layout differs from that preset's stored form, i.e.
  //     when the user has actually made changes worth resaving.
  //
  // The hook subscribes to api.onDidLayoutChange so changes update
  // the highlight live (even while the modal is open).
  const matchedPresetId = useMatchedPresetId(
    apiRef,
    open,
    predefined,
    presets,
  );

  const activeUserPresetDirty =
    activeUserPreset != null &&
    matchedPresetId !== activeUserPreset.id;

  const applyLayout = (id: string, layout: SerializedDockview) => {
    const api = apiRef.current;
    if (!api) return;
    try {
      api.fromJSON(layout);
      setLastAppliedPresetId(pageId, id);
    } catch {
      // bad payload — leave layout alone
    }
    onClose();
  };

  // The header band's "Save current as new" button now routes through
  // the command registry — same code path as Ctrl+Shift+P → "Save
  // Current Layout as New". `workspace.openLayouts` is the registered
  // preMacro; firing it while the modal is already open is a no-op
  // (the rail's handler just sets `layoutsOpen = true` again).
  const onSaveAsNew = () => {
    void useCommandStore.getState().runById("layouts.saveAsNew");
  };

  const onResave = () => {
    const api = apiRef.current;
    if (!api || !activeUserPreset) return;
    resavePreset(pageId, activeUserPreset.id, api.toJSON());
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Layouts"
      description="Apply a predefined or saved workspace layout."
      width="2xl"
      footer={
        <Button variant="secondary" size="sm" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Header band — save / resave actions.
         *
         *   - "Save Current as New" disables when the live layout
         *     exactly matches some saved layout (predefined or user).
         *     No point creating a duplicate.
         *   - "Resave Current" enables only when there's an applied
         *     user preset AND the live layout differs from it.
         *
         * Wrapped in a bordered band that sits flush against the modal
         * body's edges (mirrors EditorSettingsModal's footer band
         * convention) so the action row reads as part of the dialog's
         * structural chrome, not as floating buttons above the grid. */}
        <div className="border-b border-zinc-800 px-5 py-3 -mx-5 -mt-4 flex items-center gap-2 flex-wrap">
          <Tooltip
            stages={[
              { delay: 1000, content: <span>Save current as new</span> },
              {
                delay: 3000,
                content: (
                  <div>
                    <div className="font-semibold">Save current as new</div>
                    <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                      {matchedPresetId !== null
                        ? "Current layout already matches a saved layout — no point creating a duplicate."
                        : "Captures the current dockview layout (panel positions + sizes) as a new user preset for this page."}
                    </div>
                  </div>
                ),
              },
            ]}
          >
            <Button
              variant="primary"
              size="sm"
              onClick={onSaveAsNew}
              disabled={matchedPresetId !== null}
            >
              <Plus size={14} className="mr-1" />
              Save current as new
            </Button>
          </Tooltip>
          <Tooltip
            stages={[
              { delay: 1000, content: <span>Resave current</span> },
              {
                delay: 3000,
                content: (
                  <div>
                    <div className="font-semibold">Resave current</div>
                    <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                      {activeUserPreset == null
                        ? "Apply a saved layout first to enable resave."
                        : !activeUserPresetDirty
                          ? `"${activeUserPreset.name}" already matches the current layout — nothing to overwrite.`
                          : `Overwrites "${activeUserPreset.name}" with the current dockview layout.`}
                    </div>
                  </div>
                ),
              },
            ]}
          >
            <Button
              variant="secondary"
              size="sm"
              onClick={onResave}
              disabled={!activeUserPresetDirty}
            >
              <Save size={14} className="mr-1" />
              Resave current
            </Button>
          </Tooltip>
        </div>

        {/* Card grid */}
        <div
          className={cn(
            "grid gap-3",
            "grid-cols-2 md:grid-cols-3 lg:grid-cols-4",
          )}
        >
          {predefined.map((p) => (
            <LayoutCard
              key={p.id}
              id={p.id}
              name={p.name}
              layout={p.layout}
              active={matchedPresetId === p.id}
              builtIn
              onClick={() => applyLayout(p.id, p.layout)}
            />
          ))}
        </div>

        {presets.length > 0 ? (
          <>
            <div className="flex items-center gap-3">
              <span className="section-eyebrow">My Layouts</span>
              <div className="flex-1 h-px bg-(--color-border)" />
            </div>
            <div
              className={cn(
                "grid gap-3",
                "grid-cols-2 md:grid-cols-3 lg:grid-cols-4",
              )}
            >
              {presets.map((p: WorkspacePreset) => (
                <LayoutCard
                  key={p.id}
                  id={p.id}
                  name={p.name}
                  layout={p.layout}
                  active={matchedPresetId === p.id}
                  autoEdit={editingPresetId === p.id}
                  onEditEnd={() => clearEditingPresetId(pageId)}
                  onClick={() => applyLayout(p.id, p.layout)}
                  onRename={(next) => renamePreset(pageId, p.id, next)}
                  onDelete={() => deletePreset(pageId, p.id)}
                />
              ))}
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}

/**
 * Strip runtime-only fields from a dockview layout snapshot so two
 * snapshots can be compared structurally without false positives from
 * fields that change without the user changing the layout (e.g.
 * floating-group positions, active-panel tracking).
 *
 * We keep: grid root + panel registry. We drop: popoutGroups,
 * floatingGroups, activeGroup. The result is JSON-serialised for
 * cheap structural comparison via string equality.
 */
function fingerprintLayout(layout: SerializedDockview | null): string {
  if (!layout) return "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyLayout = layout as any;
  const minimal = {
    grid: anyLayout.grid ?? null,
    panels: anyLayout.panels ?? {},
  };
  return JSON.stringify(minimal);
}

/**
 * Watches the live dockview layout and returns the id of the preset
 * (predefined or user) whose layout exactly matches the current state,
 * or null if the current layout doesn't match any.
 *
 * Re-evaluates on every api.onDidLayoutChange while the modal is open
 * (and once on open) so the highlight + button states stay live as
 * the user drags panels around. When the modal is closed we skip the
 * subscription — no need to update state nothing's reading.
 */
function useMatchedPresetId(
  apiRef: React.MutableRefObject<DockviewApi | null>,
  open: boolean,
  predefined: readonly { id: string; layout: SerializedDockview }[],
  presets: readonly WorkspacePreset[],
): string | null {
  const [matched, setMatched] = React.useState<string | null>(null);

  // Compute fingerprints once per preset list change — comparing
  // string equality is O(n) per evaluate(), cheap enough that we
  // don't memoize harder.
  const presetFingerprints = React.useMemo(() => {
    const out: Array<{ id: string; fp: string }> = [];
    for (const p of predefined) out.push({ id: p.id, fp: fingerprintLayout(p.layout) });
    for (const p of presets) out.push({ id: p.id, fp: fingerprintLayout(p.layout) });
    return out;
  }, [predefined, presets]);

  React.useEffect(() => {
    if (!open) return;
    const api = apiRef.current;
    if (!api) return;
    const evaluate = () => {
      let live: SerializedDockview | null = null;
      try {
        live = api.toJSON();
      } catch {
        live = null;
      }
      const liveFp = fingerprintLayout(live);
      let hit: string | null = null;
      for (const { id, fp } of presetFingerprints) {
        if (fp === liveFp) {
          hit = id;
          break;
        }
      }
      setMatched(hit);
    };
    evaluate();
    const sub = api.onDidLayoutChange(evaluate);
    return () => sub.dispose();
  }, [open, apiRef, presetFingerprints]);

  return matched;
}

export default LayoutsModal;
