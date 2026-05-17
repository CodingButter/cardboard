import React from "react";
import {
  ChevronDown,
  ChevronRight,
  File as FileIcon,
  FilePlus,
  FolderOpen,
  FolderClosed,
  RefreshCw,
} from "lucide-react";
import {
  DropdownMenu,
  IconButton,
  PanelHeader,
  ScrollArea,
} from "../../components/ui/index";
import { cn } from "../../lib/cn";

/**
 * ScriptsFileTree — left rail of the Scripts view.
 *
 * Reads the project's `scripts/**` IDB assets and groups them into a
 * folder hierarchy. Selection highlights the active path; right-click
 * opens a New / Rename / Delete menu.
 *
 * Drag-and-drop reorder/move is intentionally deferred — WIRING: the
 * tree-node onDrop hooks are stubbed but unused. R5 polish or a
 * follow-up adds full DnD once we have asset-move IDB support.
 */

export interface ScriptFileEntry {
  /** Full asset path, e.g. `scripts/systems/foo.js`. */
  path: string;
  /** Last-modified ms. Drives the secondary sort key. */
  updatedAt: number;
}

interface TreeNode {
  /** Display name (last path segment). */
  name: string;
  /** Full path for files; directory path for folders. */
  path: string;
  kind: "file" | "folder";
  children?: TreeNode[];
}

export interface ScriptsFileTreeProps {
  files: ReadonlyArray<ScriptFileEntry>;
  activePath: string | null;
  dirtyPaths: ReadonlySet<string>;
  onSelect: (path: string) => void;
  onCreate: (folderPath: string) => Promise<void> | void;
  onRename: (oldPath: string, newPath: string) => Promise<void> | void;
  onDelete: (path: string) => Promise<void> | void;
  onRefresh: () => void;
}

export function ScriptsFileTree({
  files,
  activePath,
  dirtyPaths,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onRefresh,
}: ScriptsFileTreeProps) {
  const tree = React.useMemo(() => buildTree(files), [files]);

  // Folders default to expanded; remember collapses per-mount.
  const [collapsed, setCollapsed] = React.useState<Set<string>>(
    () => new Set(),
  );
  const toggle = React.useCallback((path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  // Inline rename: the path being edited + the staging string. `null`
  // when no rename in progress. We keep it tree-level (not per-node)
  // so a Tab-style cancellation works from anywhere.
  const [rename, setRename] = React.useState<{
    path: string;
    value: string;
  } | null>(null);

  const beginRename = React.useCallback((path: string) => {
    const last = path.split("/").pop() ?? path;
    setRename({ path, value: last });
  }, []);
  const commitRename = React.useCallback(async () => {
    if (!rename) return;
    const next = rename.value.trim();
    setRename(null);
    if (!next) return;
    const parent = rename.path.includes("/")
      ? rename.path.slice(0, rename.path.lastIndexOf("/"))
      : "";
    const newPath = parent ? `${parent}/${next}` : next;
    if (newPath === rename.path) return;
    await onRename(rename.path, newPath);
  }, [rename, onRename]);

  return (
    <aside className="flex flex-col h-full min-h-0 border-r border-zinc-800 bg-zinc-950/40 w-[260px] shrink-0">
      <PanelHeader
        title="Scripts"
        action={
          <>
            <IconButton
              icon={<FilePlus size={14} />}
              tooltip="New script in scripts/"
              onClick={() => onCreate("scripts")}
            />
            <IconButton
              icon={<RefreshCw size={14} />}
              tooltip="Refresh tree"
              onClick={onRefresh}
            />
          </>
        }
      />
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-1 text-sm">
          {tree.children && tree.children.length > 0 ? (
            tree.children.map((node) => (
              <TreeNodeRow
                key={node.path}
                node={node}
                depth={0}
                collapsed={collapsed}
                onToggle={toggle}
                activePath={activePath}
                dirtyPaths={dirtyPaths}
                onSelect={onSelect}
                rename={rename}
                onRenameChange={(v) =>
                  setRename((cur) => (cur ? { ...cur, value: v } : null))
                }
                onRenameCommit={commitRename}
                onRenameCancel={() => setRename(null)}
                onContextAction={(action, target) => {
                  if (action === "rename") beginRename(target);
                  else if (action === "delete") void onDelete(target);
                  else if (action === "new") {
                    const folder = isFolder(node, target)
                      ? target
                      : target.slice(0, target.lastIndexOf("/")) || "scripts";
                    void onCreate(folder);
                  }
                }}
              />
            ))
          ) : (
            <div className="px-3 py-6 text-xs text-zinc-500">
              No scripts yet. Click the + above to create one.
            </div>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}

interface TreeNodeRowProps {
  node: TreeNode;
  depth: number;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  activePath: string | null;
  dirtyPaths: ReadonlySet<string>;
  onSelect: (path: string) => void;
  rename: { path: string; value: string } | null;
  onRenameChange: (v: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  onContextAction: (
    action: "new" | "rename" | "delete",
    target: string,
  ) => void;
}

function TreeNodeRow(props: TreeNodeRowProps) {
  const {
    node,
    depth,
    collapsed,
    onToggle,
    activePath,
    dirtyPaths,
    onSelect,
    rename,
    onRenameChange,
    onRenameCommit,
    onRenameCancel,
    onContextAction,
  } = props;

  const isFolderNode = node.kind === "folder";
  const isOpen = isFolderNode && !collapsed.has(node.path);
  const isActive = !isFolderNode && activePath === node.path;
  const isDirty = !isFolderNode && dirtyPaths.has(node.path);
  const renaming = rename?.path === node.path;

  const padLeft = 6 + depth * 12;

  const onRowClick = React.useCallback(() => {
    if (isFolderNode) onToggle(node.path);
    else onSelect(node.path);
  }, [isFolderNode, node.path, onSelect, onToggle]);

  const [menuOpen, setMenuOpen] = React.useState<{
    x: number;
    y: number;
  } | null>(null);

  const onContextMenu = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setMenuOpen({ x: e.clientX, y: e.clientY });
  }, []);

  React.useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(null);
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("blur", close);
    };
  }, [menuOpen]);

  return (
    <>
      <div
        role="treeitem"
        aria-expanded={isFolderNode ? isOpen : undefined}
        aria-selected={isActive}
        onClick={onRowClick}
        onContextMenu={onContextMenu}
        className={cn(
          "group flex items-center gap-1.5 h-7 rounded-sm pr-2 cursor-pointer select-none",
          "text-xs",
          isActive
            ? "bg-amber-500/15 text-amber-200"
            : "text-zinc-300 hover:bg-zinc-900/60",
        )}
        style={{ paddingLeft: padLeft }}
      >
        {isFolderNode ? (
          isOpen ? (
            <ChevronDown size={12} className="text-zinc-500 shrink-0" />
          ) : (
            <ChevronRight size={12} className="text-zinc-500 shrink-0" />
          )
        ) : (
          <span className="w-3 shrink-0" />
        )}
        {isFolderNode ? (
          isOpen ? (
            <FolderOpen size={14} className="text-amber-400/80 shrink-0" />
          ) : (
            <FolderClosed size={14} className="text-zinc-500 shrink-0" />
          )
        ) : (
          <FileIcon
            size={13}
            className={cn(
              "shrink-0",
              isActive ? "text-amber-300" : "text-zinc-500",
            )}
          />
        )}
        {renaming ? (
          <input
            autoFocus
            value={rename.value}
            onChange={(e) => onRenameChange(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onRenameCommit();
              } else if (e.key === "Escape") {
                onRenameCancel();
              }
            }}
            onBlur={onRenameCommit}
            className={cn(
              "flex-1 min-w-0 bg-zinc-900 border border-amber-500/60",
              "rounded-sm px-1.5 text-xs text-zinc-100 outline-none",
              "focus-visible:ring-1 focus-visible:ring-amber-400",
            )}
          />
        ) : (
          <span className="truncate flex-1">
            {node.name}
            {isDirty && <span className="ml-1 text-amber-400">•</span>}
          </span>
        )}
      </div>

      {menuOpen && (
        <FloatingMenu
          x={menuOpen.x}
          y={menuOpen.y}
          onClose={() => setMenuOpen(null)}
          isFolderNode={isFolderNode}
          onAction={(act) => onContextAction(act, node.path)}
        />
      )}

      {isFolderNode && isOpen && node.children?.map((child) => (
        <TreeNodeRow
          key={child.path}
          node={child}
          depth={depth + 1}
          collapsed={collapsed}
          onToggle={onToggle}
          activePath={activePath}
          dirtyPaths={dirtyPaths}
          onSelect={onSelect}
          rename={rename}
          onRenameChange={onRenameChange}
          onRenameCommit={onRenameCommit}
          onRenameCancel={onRenameCancel}
          onContextAction={onContextAction}
        />
      ))}
    </>
  );
}

/**
 * Bare-bones right-click menu. Uses fixed positioning relative to the
 * viewport — fine for a single-level menu. Could be lifted into a
 * shared primitive (a `ContextMenu` peer to `DropdownMenu`) when
 * a second view needs it.
 */
function FloatingMenu({
  x,
  y,
  onClose,
  isFolderNode,
  onAction,
}: {
  x: number;
  y: number;
  onClose: () => void;
  isFolderNode: boolean;
  onAction: (act: "new" | "rename" | "delete") => void;
}) {
  void onClose; // closed by parent's window listener
  const items: Array<{
    id: "new" | "rename" | "delete";
    label: string;
    danger?: boolean;
  }> = [];
  if (isFolderNode) items.push({ id: "new", label: "New script…" });
  items.push({ id: "rename", label: "Rename…" });
  items.push({ id: "delete", label: "Delete", danger: true });

  return (
    <div
      role="menu"
      style={{ position: "fixed", left: x, top: y, zIndex: 60 }}
      className={cn(
        "min-w-[160px] py-1 rounded-md border border-zinc-700",
        "bg-zinc-900 shadow-lg text-xs",
      )}
    >
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          onClick={() => onAction(it.id)}
          className={cn(
            "w-full text-left px-3 py-1.5",
            it.danger
              ? "text-red-300 hover:bg-red-500/10"
              : "text-zinc-200 hover:bg-zinc-800",
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

// Silence unused-import lint for the DropdownMenu primitive — kept
// in scope for future "Sort by…" affordance per the mockup. WIRING:
// remove once the bottom-of-tree sort menu lands.
void DropdownMenu;

/** Group flat file paths into a folder tree. */
function buildTree(files: ReadonlyArray<ScriptFileEntry>): TreeNode {
  const root: TreeNode = { name: "scripts", path: "scripts", kind: "folder", children: [] };
  // Sort: folders first within each level. We achieve that by
  // inserting in path-sorted order and bubbling folders ahead.
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  for (const entry of sorted) {
    insertPath(root, entry.path);
  }
  // Recursively sort each folder's children — folders first.
  sortNode(root);
  return root;
}

function insertPath(root: TreeNode, fullPath: string) {
  const parts = fullPath.split("/");
  if (parts.length === 0) return;
  let cursor = root;
  let acc = "";
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    acc = acc ? `${acc}/${part}` : part;
    const isLast = i === parts.length - 1;
    if (isLast) {
      cursor.children = cursor.children ?? [];
      cursor.children.push({ name: part, path: acc, kind: "file" });
      return;
    }
    cursor.children = cursor.children ?? [];
    let next = cursor.children.find(
      (c) => c.kind === "folder" && c.name === part,
    );
    if (!next) {
      next = { name: part, path: acc, kind: "folder", children: [] };
      cursor.children.push(next);
    }
    cursor = next;
  }
}

function sortNode(node: TreeNode) {
  if (!node.children) return;
  node.children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const c of node.children) if (c.kind === "folder") sortNode(c);
}

function isFolder(root: TreeNode, path: string): boolean {
  // Walks the tree to determine if `path` resolves to a folder.
  // Linear in path depth; fine for tree-row clicks.
  const parts = path.split("/");
  let cursor: TreeNode | undefined = root;
  let acc = "";
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    cursor = cursor?.children?.find((c) => c.name === part);
    if (!cursor) return false;
    if (cursor.path === path) return cursor.kind === "folder";
  }
  return cursor?.kind === "folder";
}
