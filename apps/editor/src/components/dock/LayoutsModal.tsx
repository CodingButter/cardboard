import React from "react";
import { createPortal } from "react-dom";
import { Lock, Plus, Save, MoreVertical } from "lucide-react";
import type { DockviewApi, SerializedDockview } from "dockview";
import { cn } from "../../lib/cn";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { LayoutSkeleton } from "./LayoutSkeleton";
import {
  useWorkspaceStore,
  type WorkspacePreset,
} from "../../state/useWorkspaceStore";
import { getPredefinedLayouts } from "../../state/predefinedLayouts";

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
  onClick,
  onRename,
  onDelete,
}: CardBaseProps): React.JSX.Element {
  const [menu, setMenu] = React.useState<
    | { kind: "closed" }
    | { kind: "open"; x: number; y: number }
    | { kind: "rename" }
    | { kind: "confirm-delete" }
  >({ kind: "closed" });
  const [renameValue, setRenameValue] = React.useState(name);

  React.useEffect(() => setRenameValue(name), [name]);

  const menuOpen = menu.kind !== "closed";

  React.useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest(PRESET_SENTINEL)) return;
      setMenu({ kind: "closed" });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu({ kind: "closed" });
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
    onRename?.(renameValue);
    setMenu({ kind: "closed" });
  };

  return (
    <>
      <button
        type="button"
        data-layouts-card={id}
        data-active={active ? "true" : "false"}
        onClick={onClick}
        onContextMenu={onContextMenu}
        className={cn(
          "group relative flex flex-col gap-2 rounded-md border p-2 text-left",
          "transition-colors",
          active
            ? "border-(--color-accent) bg-(--color-accent)/10"
            : "border-(--color-border) hover:border-(--color-border-strong) bg-(--color-bg-card)",
        )}
        title={name}
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
        {/* Footer row: name + badges */}
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={cn(
              "flex-1 truncate text-[12px]",
              active
                ? "text-(--color-fg-primary) font-medium"
                : "text-(--color-fg-secondary)",
            )}
          >
            {name}
          </span>
          {builtIn ? (
            <Lock
              size={11}
              aria-label="Built-in layout"
              className="text-(--color-fg-muted) shrink-0"
            />
          ) : null}
          {!builtIn ? (
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
          ) : null}
        </div>
      </button>

      {menu.kind === "rename"
        ? createPortal(
            <div
              data-layouts-card-menu
              className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50"
              onClick={() => {
                setRenameValue(name);
                setMenu({ kind: "closed" });
              }}
            >
              <div
                className={cn(
                  "card-surface-elev px-4 py-3 rounded border",
                  "border-(--color-border-strong) flex items-center gap-2",
                  "bg-(--color-bg-card-elev)",
                )}
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  autoFocus
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") {
                      setRenameValue(name);
                      setMenu({ kind: "closed" });
                    }
                  }}
                  className={cn(
                    "px-2 py-1 text-sm rounded outline-none",
                    "bg-(--color-bg-card) border border-(--color-border)",
                    "focus:border-(--color-accent)",
                    "text-(--color-fg-primary)",
                  )}
                />
                <Button variant="primary" size="sm" onClick={commitRename}>
                  Save
                </Button>
              </div>
            </div>,
            document.body,
          )
        : null}

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
                onClick={() => setMenu({ kind: "rename" })}
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
  const predefined = React.useMemo(
    () => getPredefinedLayouts(pageId),
    [pageId],
  );

  const presets = useWorkspaceStore(
    (s) => s.presets[pageId] ?? EMPTY_USER_PRESETS,
  );
  const lastAppliedPresetId = useWorkspaceStore(
    (s) => s.lastAppliedPresetId[pageId] ?? null,
  );
  const savePreset = useWorkspaceStore((s) => s.savePreset);
  const renamePreset = useWorkspaceStore((s) => s.renamePreset);
  const deletePreset = useWorkspaceStore((s) => s.deletePreset);
  const resavePreset = useWorkspaceStore((s) => s.resavePreset);
  const setLastAppliedPresetId = useWorkspaceStore(
    (s) => s.setLastAppliedPresetId,
  );

  const activeUserPreset = React.useMemo(
    () => presets.find((p) => p.id === lastAppliedPresetId) ?? null,
    [presets, lastAppliedPresetId],
  );

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

  const onSaveAsNew = () => {
    const api = apiRef.current;
    if (!api) return;
    const name = window.prompt("Name this layout:", "New layout");
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const preset = savePreset(pageId, trimmed, api.toJSON());
    setLastAppliedPresetId(pageId, preset.id);
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
      width="3xl"
    >
      <div className="flex flex-col gap-4">
        {/* Header band — save / resave actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="primary" size="sm" onClick={onSaveAsNew}>
            <Plus size={14} className="mr-1" />
            Save current as new
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={onResave}
            disabled={!activeUserPreset}
            title={
              activeUserPreset
                ? `Overwrite "${activeUserPreset.name}" with the current layout`
                : "Apply a saved layout first to enable resave"
            }
          >
            <Save size={14} className="mr-1" />
            Resave current
          </Button>
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
              active={lastAppliedPresetId === p.id}
              builtIn
              onClick={() => applyLayout(p.id, p.layout)}
            />
          ))}
        </div>

        {presets.length > 0 ? (
          <>
            <div className="flex items-center gap-3">
              <span className="text-[10px] uppercase tracking-wider text-(--color-fg-muted)">
                My Layouts
              </span>
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
                  active={lastAppliedPresetId === p.id}
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

const EMPTY_USER_PRESETS: WorkspacePreset[] = [];

export default LayoutsModal;
