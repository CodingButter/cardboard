import React from "react";
import {
  FolderOpen,
  Plus,
  Upload,
  Link as LinkIcon,
  Play,
  Pencil,
  Trash2,
  Settings,
  ExternalLink,
  Sparkles,
  BookOpen,
  GitBranch,
} from "lucide-react";
import {
  EditorProjectStore,
  type ProjectMeta,
} from "../lib/EditorProjectStore";
import {
  importPackFromBlob,
  importPackFromUrl,
} from "../lib/importPack";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Modal,
} from "../components/ui";
import {
  Badge,
  EmptyState,
  FilePicker,
  IconButton,
  KeyValueList,
  PanelHeader,
  ScrollArea,
  StatsBlock,
} from "../components/ui/index";
import { useStatusBar } from "../shell/StatusBarContext";
import type { StatusBarSection } from "../components/ui/StatusBar";
import { cn } from "../lib/cn";

/**
 * Home view — R4a redesign.
 *
 * Spec: docs/plans/EDITOR_REDESIGN.md §7.1.
 *
 * Composition (per §6.5 grammar):
 *   <aside col-span-3>  — Recents sidebar (PanelHeader + scrollable list).
 *   <main  col-span-6>  — Project grid (cards with thumbnail + metadata + Play).
 *   <aside col-span-3>  — Create / import actions + templates + quick links.
 *
 * The view does NOT register Save / Export EditorActions — Home has no
 * project context to save against. The shell keeps the TopBar Save /
 * Export buttons in their default disabled state.
 *
 * StatusBar contribution (pushed via useStatusBar() on mount):
 *   - project-count : "Projects" | <n>
 *   - last-opened   : "Last opened" | <project-name or em-dash>
 *
 * EmptyState (no projects yet) is rendered inside the main column.
 */

interface HomeScreenProps {
  onOpenProject: (id: string) => void;
}

export function HomeScreen({ onOpenProject }: HomeScreenProps) {
  const [projects, setProjects] = React.useState<ProjectMeta[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // URL-import dialog state.
  const [urlOpen, setUrlOpen] = React.useState(false);
  const [urlInput, setUrlInput] = React.useState("");
  const [hashInput, setHashInput] = React.useState("");
  const [urlConfirmed, setUrlConfirmed] = React.useState(false);

  const refreshProjects = React.useCallback(async () => {
    setLoading(true);
    try {
      const list = await EditorProjectStore.listProjects();
      setProjects(list);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  // ─── StatusBar wiring ────────────────────────────────────────────────
  // Push project-count + last-opened sections while Home is mounted.
  // The shell's StatusBar reads these via useStatusBarSections().
  const { setSections } = useStatusBar();
  React.useEffect(() => {
    const mostRecent = projects[0]; // listProjects() returns newest-first.
    const sections: StatusBarSection[] = [
      { id: "project-count", label: "Projects", value: String(projects.length) },
      {
        id: "last-opened",
        label: "Last opened",
        value: mostRecent?.name ?? "—",
      },
    ];
    setSections(sections);
    return () => setSections([]);
  }, [projects, setSections]);

  // ─── Actions ──────────────────────────────────────────────────────────

  const handleCreate = async () => {
    const name = window.prompt("Project name?", "Untitled project")?.trim();
    if (!name) return;
    try {
      setBusy("create");
      const meta = await EditorProjectStore.createProject(name);
      onOpenProject(meta.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const handleImportFile = async (file: File) => {
    try {
      setBusy("import-file");
      setError(null);
      const result = await importPackFromBlob(file);
      onOpenProject(result.project.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const handleImportUrl = async () => {
    const url = urlInput.trim();
    if (!url) return;
    try {
      setBusy("import-url");
      setError(null);
      const result = await importPackFromUrl(url, {
        expectedSha256: hashInput.trim() || undefined,
      });
      setUrlOpen(false);
      setUrlInput("");
      setHashInput("");
      setUrlConfirmed(false);
      onOpenProject(result.project.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const handleRename = async (id: string, currentName: string) => {
    const name = window.prompt("New project name?", currentName)?.trim();
    if (!name || name === currentName) return;
    try {
      await EditorProjectStore.renameProject(id, name);
      await refreshProjects();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    const ok = window.confirm(
      `Delete "${name}"? This permanently removes the project and all its assets from your browser.`,
    );
    if (!ok) return;
    try {
      await EditorProjectStore.deleteProject(id);
      await refreshProjects();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  // ─── Derived ─────────────────────────────────────────────────────────

  const mostRecent = projects[0];
  const totalProjects = projects.length;
  // WIRING: real "imported pack count" — `ProjectMeta.forkedFrom` is set
  // for any URL/blob import. Count those once additional provenance
  // shapes land.
  const importedCount = projects.filter((p) => p.forkedFrom).length;

  return (
    <div className="grid grid-cols-12 gap-6 h-full p-6 text-zinc-100">
      {/* ─────────── Recents sidebar (left, 3 cols) ─────────── */}
      <aside className="col-span-12 lg:col-span-3 flex flex-col min-h-0 rounded-lg border border-zinc-800 bg-zinc-950/40 overflow-hidden">
        <PanelHeader
          title="Recents"
          action={
            totalProjects > 0 ? (
              <Badge variant="zinc">{totalProjects}</Badge>
            ) : null
          }
        />
        <ScrollArea className="flex-1 min-h-0 p-2">
          {loading ? (
            <div className="px-3 py-6 text-xs text-zinc-500 text-center">
              Loading…
            </div>
          ) : projects.length === 0 ? (
            <div className="px-3 py-6 text-xs text-zinc-500 text-center leading-relaxed">
              No recent projects.
              <br />
              Create one or import a pack.
            </div>
          ) : (
            <ul className="space-y-1">
              {projects.slice(0, 12).map((p) => {
                const isMostRecent = p.id === mostRecent?.id;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => onOpenProject(p.id)}
                      className={cn(
                        "w-full text-left rounded-md px-3 py-2 transition-colors",
                        "hover:bg-zinc-800/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400",
                        isMostRecent
                          ? "bg-amber-500/10 border border-amber-500/40 text-amber-100"
                          : "border border-transparent text-zinc-200",
                      )}
                    >
                      <div className="text-sm font-medium truncate">
                        {p.name}
                      </div>
                      <div className="text-[11px] text-zinc-500 mt-0.5 truncate">
                        {formatRelative(p.modifiedAt)}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
        <div className="border-t border-zinc-800 px-3 py-2 grid grid-cols-2 gap-2">
          <StatsBlock label="Total" value={String(totalProjects)} />
          <StatsBlock
            label="Imported"
            value={String(importedCount)}
            emphasis={importedCount > 0 ? "success" : "default"}
          />
        </div>
      </aside>

      {/* ─────────── Project grid (center, 6 cols) ─────────── */}
      <main className="col-span-12 lg:col-span-6 flex flex-col min-h-0">
        <header className="flex items-end justify-between mb-4 shrink-0">
          <div>
            <h1 className="text-lg font-semibold text-zinc-100">
              Your projects
            </h1>
            <p className="text-xs text-zinc-500 mt-0.5">
              Everything lives in your browser — nothing is uploaded.
            </p>
          </div>
          <Button
            variant="primary"
            onClick={handleCreate}
            disabled={busy !== null}
            className="gap-2"
          >
            <Plus size={14} />
            New project
          </Button>
        </header>

        {error ? (
          <div className="mb-4 rounded-md border border-red-700/60 bg-red-900/30 px-4 py-3 text-sm text-red-200">
            <div className="font-medium">Something went wrong</div>
            <div className="mt-1 text-red-300/90">{error}</div>
            <button
              type="button"
              className="mt-2 text-xs text-red-200 hover:text-white underline underline-offset-2"
              onClick={() => setError(null)}
            >
              Dismiss
            </button>
          </div>
        ) : null}

        <ScrollArea className="flex-1 min-h-0 -mx-1 px-1">
          {loading ? (
            <div className="py-12 text-sm text-zinc-500 text-center">
              Loading projects…
            </div>
          ) : projects.length === 0 ? (
            <EmptyState
              icon={<FolderOpen size={24} />}
              title="No projects yet"
              description="Start a fresh project or import an existing pack to begin authoring."
              tutorial="home-intro"
              action={
                <>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleCreate}
                    disabled={busy !== null}
                    className="gap-2"
                  >
                    <Plus size={14} />
                    New project
                  </Button>
                  <FilePicker
                    mode="button"
                    accept=".apg,application/zip"
                    onFiles={(files) => files[0] && handleImportFile(files[0])}
                    disabled={busy !== null}
                  >
                    Import .apg
                  </FilePicker>
                </>
              }
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-2">
              {projects.map((p) => {
                const isMostRecent = p.id === mostRecent?.id;
                return (
                  <ProjectCard
                    key={p.id}
                    project={p}
                    highlight={isMostRecent}
                    onOpen={() => onOpenProject(p.id)}
                    onRename={() => handleRename(p.id, p.name)}
                    onDelete={() => handleDelete(p.id, p.name)}
                  />
                );
              })}
            </div>
          )}
        </ScrollArea>
      </main>

      {/* ─────────── Create / import / quick links (right, 3 cols) ─────────── */}
      <aside className="col-span-12 lg:col-span-3 flex flex-col min-h-0 space-y-4 overflow-y-auto">
        <Card>
          <CardHeader>
            <CardTitle>Create or import</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              variant="primary"
              className="w-full gap-2"
              onClick={handleCreate}
              disabled={busy !== null}
            >
              <Plus size={14} />
              New empty project
            </Button>
            <FilePicker
              mode="dropzone"
              accept=".apg,application/zip"
              onFiles={(files) => files[0] && handleImportFile(files[0])}
              disabled={busy !== null}
              className="min-h-[120px]"
            >
              <Upload size={22} className="text-zinc-400" aria-hidden="true" />
              <div className="text-sm text-zinc-200 font-medium">
                {busy === "import-file"
                  ? "Importing…"
                  : "Drop a .apg pack here"}
              </div>
              <div className="text-[11px] text-zinc-500">
                or click to browse
              </div>
            </FilePicker>
            <Button
              variant="secondary"
              className="w-full gap-2"
              onClick={() => setUrlOpen(true)}
              disabled={busy !== null}
            >
              <LinkIcon size={14} />
              Open URL pack
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Templates</CardTitle>
          </CardHeader>
          <CardContent>
            {/* WIRING: real template gallery. Spec §7.1 calls for tiles
                (Empty / Classic Dungeon / Sci-Fi Base) that bootstrap a
                project from a starter pack manifest. Wire this once the
                pack-templates module exists (likely under
                packages/default-pack/templates/ + an
                EditorProjectStore.createFromTemplate(id) helper). */}
            <div className="grid grid-cols-1 gap-2">
              <TemplateTile
                disabled
                title="Empty"
                caption="Blank manifest + one starter scene."
              />
              <TemplateTile
                disabled
                title="Classic Dungeon"
                caption="Tile palette + sample mobs."
                badge="Soon"
              />
              <TemplateTile
                disabled
                title="Sci-Fi Base"
                caption="Metal corridors + neon lights."
                badge="Soon"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick links</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <QuickLink
              href="https://github.com/codingbutter/two_5_d"
              icon={<GitBranch size={14} />}
              label="GitHub repository"
            />
            <QuickLink
              href="https://github.com/codingbutter/two_5_d/tree/main/docs"
              icon={<BookOpen size={14} />}
              label="Docs"
            />
            {/* WIRING: open the EditorSettingsModal directly. Currently
                only the shell's TopBar cog opens it — the shell owns the
                open/close state. Either lift via a context or expose
                onOpenSettings through HomeScreenProps when needed. */}
            <button
              type="button"
              disabled
              className={cn(
                "flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs",
                "text-zinc-500 cursor-not-allowed",
              )}
              title="Open settings from the gear in the top bar"
            >
              <Settings size={14} />
              Editor settings (use top-bar gear)
            </button>
          </CardContent>
        </Card>
      </aside>

      {/* URL-import dialog */}
      <Modal
        open={urlOpen}
        onClose={() => {
          if (busy === "import-url") return;
          setUrlOpen(false);
          setUrlConfirmed(false);
        }}
        title="Open pack from URL"
        footer={
          <>
            <Button
              variant="ghost"
              disabled={busy === "import-url"}
              onClick={() => {
                setUrlOpen(false);
                setUrlConfirmed(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={
                busy === "import-url" || !urlInput.trim() || !urlConfirmed
              }
              onClick={handleImportUrl}
            >
              {busy === "import-url" ? "Fetching…" : "Open"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="pack-url">Pack URL</Label>
            <Input
              id="pack-url"
              placeholder="https://example.com/cool-pack.apg"
              className="mt-1.5"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              disabled={busy === "import-url"}
            />
          </div>
          <div>
            <Label htmlFor="pack-hash">SHA-256 (optional)</Label>
            <Input
              id="pack-hash"
              placeholder="paste hex or sha256-… to pin integrity"
              className="mt-1.5 font-mono"
              value={hashInput}
              onChange={(e) => setHashInput(e.target.value)}
              disabled={busy === "import-url"}
            />
            <p className="text-xs text-zinc-500 mt-1">
              If provided, the editor verifies the pack matches this hash
              before importing.
            </p>
          </div>
          <label className="flex items-start gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={urlConfirmed}
              onChange={(e) => setUrlConfirmed(e.target.checked)}
              disabled={busy === "import-url"}
            />
            <span>
              I understand this pack is from an unverified source. It will
              be loaded into my local editor.
            </span>
          </label>
        </div>
      </Modal>
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* ProjectCard                                                           */
/* -------------------------------------------------------------------- */

interface ProjectCardProps {
  project: ProjectMeta;
  highlight: boolean;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}

function ProjectCard({
  project,
  highlight,
  onOpen,
  onRename,
  onDelete,
}: ProjectCardProps) {
  return (
    <div
      className={cn(
        "group relative rounded-lg border bg-zinc-950/40 overflow-hidden",
        "transition-colors",
        highlight
          ? "border-amber-500/40 bg-amber-500/[0.04]"
          : "border-zinc-800 hover:border-zinc-700",
      )}
    >
      {/* Thumbnail — 16:9 region. */}
      {/* WIRING: replace placeholder with EditorProjectStore.getProjectThumbnail(id).
          The bake step (Project tab in R4f) writes a PNG into IDB; the
          Home view should `<img>` it when present and fall back to this
          radial-gradient placeholder otherwise. */}
      <button
        type="button"
        onClick={onOpen}
        className="block w-full aspect-video bg-zinc-900 relative overflow-hidden focus-visible:outline-none"
        aria-label={`Open ${project.name}`}
      >
        <div
          className="absolute inset-0"
          style={{
            background:
              highlight
                ? "radial-gradient(circle at 30% 30%, rgba(245, 158, 11, 0.25), rgba(8, 9, 11, 0.95) 65%)"
                : "radial-gradient(circle at 30% 30%, rgba(63, 63, 70, 0.6), rgba(8, 9, 11, 0.95) 65%)",
          }}
          aria-hidden="true"
        />
        <div className="absolute inset-0 flex items-center justify-center text-zinc-700">
          <Sparkles size={28} aria-hidden="true" />
        </div>
        {highlight && (
          <div className="absolute top-2 left-2">
            <Badge variant="amber">Most recent</Badge>
          </div>
        )}
        <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-amber-500 text-zinc-950 shadow-lg">
            <Play size={16} aria-hidden="true" />
          </span>
        </div>
      </button>

      <div className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <button
            type="button"
            onClick={onOpen}
            className="text-left flex-1 min-w-0 focus-visible:outline-none"
          >
            <div className="text-sm font-semibold text-zinc-100 truncate">
              {project.name}
            </div>
            <div className="text-[11px] text-zinc-500 mt-0.5 truncate">
              Updated {formatRelative(project.modifiedAt)}
            </div>
          </button>
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
            <IconButton
              icon={<Pencil size={14} />}
              tooltip="Rename"
              variant="ghost"
              onClick={onRename}
            />
            <IconButton
              icon={<Trash2 size={14} />}
              tooltip="Delete"
              variant="ghost"
              className="text-red-400 hover:text-red-200 hover:bg-red-900/30"
              onClick={onDelete}
            />
          </div>
        </div>

        <KeyValueList
          density="dense"
          divided={false}
          rows={[
            { label: "Created", value: formatDate(project.createdAt) },
            {
              label: "Source",
              value: project.forkedFrom?.url ? (
                <span title={project.forkedFrom.url}>URL import</span>
              ) : project.sourcePackId ? (
                <span title={project.sourcePackId}>Pack fork</span>
              ) : (
                <span className="text-zinc-500">Local</span>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* TemplateTile                                                          */
/* -------------------------------------------------------------------- */

interface TemplateTileProps {
  title: string;
  caption: string;
  badge?: string;
  disabled?: boolean;
  onClick?: () => void;
}

function TemplateTile({
  title,
  caption,
  badge,
  disabled = false,
  onClick,
}: TemplateTileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "text-left rounded-md border border-zinc-800 bg-zinc-950/40 p-3",
        "transition-colors",
        !disabled && "hover:border-amber-400 hover:bg-zinc-900",
        disabled && "opacity-60 cursor-not-allowed",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium text-zinc-100 truncate">
          {title}
        </div>
        {badge && <Badge variant="zinc">{badge}</Badge>}
      </div>
      <div className="text-[11px] text-zinc-500 mt-0.5 leading-relaxed">
        {caption}
      </div>
    </button>
  );
}

/* -------------------------------------------------------------------- */
/* QuickLink                                                             */
/* -------------------------------------------------------------------- */

function QuickLink({
  href,
  icon,
  label,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className={cn(
        "flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs",
        "text-zinc-300 hover:bg-zinc-800/60 hover:text-amber-300 transition-colors",
      )}
    >
      <span className="text-zinc-500">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      <ExternalLink size={12} className="text-zinc-500" aria-hidden="true" />
    </a>
  );
}

/* -------------------------------------------------------------------- */
/* Formatting helpers                                                    */
/* -------------------------------------------------------------------- */

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "just now";
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return new Date(ts).toLocaleDateString();
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
