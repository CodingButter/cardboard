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
  Check,
} from "lucide-react";
// HomeScreen migrated into the core-editor-pack during P5b
// (CORE_EDITOR_PACK.md §10 P5b). Host-singleton-dependent symbols
// (EditorProjectStore + IDB types, importPack* helpers, assetUrl,
// useStatusBar + StatusBarSection, EmptyState) route through the
// shell SDK so they share host identity. Presentational primitives
// (Button, Card, Modal, Tooltip, etc.) live in `apps/editor/src/
// components/ui/*` and bundle into the pack via relative paths —
// same convention every other pack-shipped panel uses.
import {
  EditorProjectStore,
  importPackFromBlob,
  importPackFromUrl,
  assetUrl,
  useStatusBar,
  EmptyState,
  useRoute,
  buildHash,
  type ProjectMeta,
  type StatusBarSection,
} from "@cardboard/editor-shell";

import { Button } from "../../../apps/editor/src/components/ui/Button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../../apps/editor/src/components/ui/Card";
import { TextInput } from "../../../apps/editor/src/components/ui/TextInput";
import { Textarea } from "../../../apps/editor/src/components/ui/Textarea";
import { Modal } from "../../../apps/editor/src/components/ui/Modal";
import { Badge } from "../../../apps/editor/src/components/ui/Badge";
import { FilePicker } from "../../../apps/editor/src/components/ui/FilePicker";
import { IconButton } from "../../../apps/editor/src/components/ui/IconButton";
import { KeyValueList } from "../../../apps/editor/src/components/ui/KeyValueList";
import { PanelHeader } from "../../../apps/editor/src/components/ui/PanelHeader";
import { ScrollArea } from "../../../apps/editor/src/components/ui/ScrollArea";
import { StatsBlock } from "../../../apps/editor/src/components/ui/StatsBlock";
import { Tooltip } from "../../../apps/editor/src/components/ui/Tooltip";
import { cn } from "../../../apps/editor/src/lib/cn";

/** Helper: build the two-stage tooltip stages for a label + description. */
function tipStages(label: string, description: string) {
  return [
    { delay: 1000, content: <span>{label}</span> },
    {
      delay: 3000,
      content: (
        <div>
          <div className="font-semibold">{label}</div>
          <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
            {description}
          </div>
        </div>
      ),
    },
  ];
}

/**
 * Home view — R4a redesign.
 *
 * Spec: docs/plans/EDITOR_REDESIGN.md §7.1.
 *
 * Composition (per §6.5 grammar):
 *   <aside col-span-3>  — Recents sidebar (PanelHeader + scrollable list).
 *   <main  col-span-6>  — Project grid (cards with thumbnail + metadata + Play).
 *   <aside col-span-3>  — Create / import actions + quick links.
 *
 * Templates panel removed in favour of the `CreateProjectModal` —
 * template selection now happens inline with project setup. The freed
 * right-rail space is given back to the create/import surface (more
 * breathing room) and the quick-links card.
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

/**
 * Starter project templates. Hardcoded for now; will move to a
 * Supabase fetch when CLOUD_SYNC lands (see docs/plans/CLOUD_SYNC.md).
 * Each entry: id, displayName, description, packUrl pointing at a
 * starter .apg the project's IndexedDB seeds from. `packUrl: null`
 * means "blank" — create an empty project with no asset seeding.
 *
 * Path note: in dev the editor server (apps/editor/server.ts) serves
 * from `apps/editor/public/`, which doesn't ship Cardboard.apg today.
 * The game server at port 3000 does ship it at `/packs/Cardboard.apg`.
 * Until the editor's public dir mirrors the game's packs (or until
 * we move pack hosting behind Supabase), the URL is resolved at
 * fetch time relative to the editor origin — the dev workflow is to
 * symlink or copy `apps/game/public/packs/Cardboard.apg` into
 * `apps/editor/public/packs/` (or run both apps and reach across
 * origins, in which case CORS must be enabled). Production builds
 * are expected to ship the pack alongside the editor bundle.
 */
const STARTER_TEMPLATES: ReadonlyArray<{
  id: string;
  displayName: string;
  description: string;
  packUrl: string | null;
  thumbnail?: string;
}> = [
  {
    id: "cardboard",
    displayName: "Cardboard",
    description:
      "The default starter — Wolfenstein-style raycaster with player + sample scene.",
    // assetUrl() prefixes the GitHub Pages subpath (`/cardboard/`) when
    // running on Pages; in dev / standalone-static deploys it returns
    // the path unchanged. See `apps/editor/src/lib/assetUrl.ts`.
    packUrl: assetUrl("/packs/Cardboard.apg"),
  },
  {
    id: "blank",
    displayName: "Blank project",
    description: "Empty pack — manifest scaffolded, no scenes or scripts.",
    packUrl: null,
  },
];

/**
 * Props are widened to the shell-side `ViewComponent` signature — the
 * editor shell mounts pack-contributed views WITHOUT supplying any
 * props. HomeScreen reads the active project id off the URL hash via
 * `useRoute()` and drives navigation through `buildHash` instead of an
 * `onOpenProject` callback. The previous prop-driven shape predated
 * P5b — see the migration note at the top of the file.
 */
export interface HomeScreenProps {
  [key: string]: unknown;
}

export function HomeScreen(_props: HomeScreenProps = {}): React.JSX.Element {
  // Route-driven currentProjectId + "open project" navigation. The shell
  // shell narrows `route.tab` separately; we only need the projectId
  // here. Picking a project lands the user on the Scene tab — the
  // canonical workflow entry — and stamps the hash with both segments
  // so reload/back/forward all keep working.
  const [route, navigate] = useRoute();
  const currentProjectId = route.projectId ?? null;
  const onOpenProject = React.useCallback(
    (id: string) => {
      navigate(buildHash(id, "scene"));
    },
    [navigate],
  );
  const [projects, setProjects] = React.useState<ProjectMeta[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Create-project modal state.
  const [createOpen, setCreateOpen] = React.useState(false);

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

  // ─── Command registry wiring ────────────────────────────────────────
  // HomeScreen-owned commands. The static `homescreen.newProject` /
  // `homescreen.openUrlPack` and the dynamic `homescreen.openProject.<id>`
  // commands are registered at the SHELL level (EditorShell) so they're
  // discoverable from ANY tab, not just Home. The shell dispatches the
  // events below and HomeScreen reacts:
  //   - cardboard:home-new-project    → opens the create-project modal
  //   - cardboard:home-open-url-pack  → opens the URL-import modal
  // Both events also navigate to the Home tab before firing (the shell's
  // command handler takes care of that), so the modal is always visible
  // when the action triggers. HomeScreen in turn fires
  // `cardboard:projects-changed` when its project list mutates so the
  // shell can refresh the per-project palette entries.

  // Subscribe to the shell-level command events.
  React.useEffect(() => {
    const onNew = () => setCreateOpen(true);
    const onUrl = () => setUrlOpen(true);
    window.addEventListener("cardboard:home-new-project", onNew);
    window.addEventListener("cardboard:home-open-url-pack", onUrl);
    return () => {
      window.removeEventListener("cardboard:home-new-project", onNew);
      window.removeEventListener("cardboard:home-open-url-pack", onUrl);
    };
  }, []);

  // Notify the shell whenever HomeScreen mutates the project list so
  // it can refresh its own `homescreen.openProject.<id>` registration.
  // The shell owns those commands so they're discoverable from any
  // tab; HomeScreen only fires the change event.
  React.useEffect(() => {
    if (!loading) {
      window.dispatchEvent(new CustomEvent("cardboard:projects-changed"));
    }
  }, [projects.length, loading]);

  // ─── Project name uniqueness helper ─────────────────────────────────
  // Tiny case-insensitive compare so "Untitled" and "untitled" clash.
  const nameTaken = React.useCallback(
    (candidate: string): boolean => {
      const norm = candidate.trim().toLowerCase();
      return projects.some((p) => p.name.trim().toLowerCase() === norm);
    },
    [projects],
  );

  // ─── Actions ──────────────────────────────────────────────────────────

  /**
   * Seed a freshly created project's IndexedDB from a template pack
   * URL. Thin wrapper around `importPackFromUrl` that overrides the
   * project name with the user's chosen name (the manifest's name
   * would otherwise win). When `packUrl` is null we just create an
   * empty project — no asset seeding needed.
   *
   * Returns the new project's id (for navigation).
   *
   * Future: when CLOUD_SYNC lands this is where we'd flip to a
   * Supabase signed-URL fetch + (optional) provenance stamp.
   */
  const seedProjectFromTemplate = React.useCallback(
    async (
      name: string,
      packUrl: string | null,
    ): Promise<string> => {
      if (!packUrl) {
        const meta = await EditorProjectStore.createProject(name);
        return meta.id;
      }
      // importPackFromUrl creates the project AND seeds its assets in
      // one pass; we just override the manifest's name so the project
      // shows up under the user's chosen name in the recents list.
      const result = await importPackFromUrl(packUrl, {
        projectName: name,
      });
      return result.project.id;
    },
    [],
  );

  const handleCreate = async (
    name: string,
    template: (typeof STARTER_TEMPLATES)[number],
    _description: string,
  ) => {
    try {
      setBusy("create");
      setError(null);
      const projectId = await seedProjectFromTemplate(name, template.packUrl);
      setCreateOpen(false);
      onOpenProject(projectId);
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
                const isCurrent = p.id === currentProjectId;
                const isMostRecent =
                  !isCurrent && p.id === mostRecent?.id;
                return (
                  <li key={p.id}>
                    <Tooltip
                      stages={tipStages(
                        `Open ${p.name}`,
                        isCurrent
                          ? `${p.name} is the project you're currently working in. Click to navigate back to its scene editor.`
                          : `Switch to the ${p.name} project — last modified ${formatRelative(p.modifiedAt)}.`,
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => onOpenProject(p.id)}
                        aria-current={isCurrent ? "true" : undefined}
                        className={cn(
                          "w-full text-left rounded-md px-3 py-2 transition-colors",
                          "hover:bg-zinc-800/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400",
                          isCurrent
                            ? // Active project (carried in the URL hash) —
                              // distinct left-accent rail so it stands out
                              // even when it's also the most-recent item.
                              "bg-amber-500/15 border border-amber-500/60 border-l-4 border-l-amber-400 text-amber-50"
                            : isMostRecent
                              ? "bg-amber-500/5 border border-amber-500/30 text-amber-100"
                              : "border border-transparent text-zinc-200",
                        )}
                      >
                        <div className="text-sm font-medium truncate">
                          {p.name}
                        </div>
                        <div className="text-[11px] text-zinc-500 mt-0.5 truncate">
                          {isCurrent
                            ? "Current project"
                            : formatRelative(p.modifiedAt)}
                        </div>
                      </button>
                    </Tooltip>
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
          {/* Header CTA removed — the right-rail "Create or import" panel
              now owns the New Project / Open URL primary actions. Avoids a
              redundant duplicate at the top of the main column. */}
        </header>

        {error ? (
          <div className="mb-4 rounded-md border border-red-700/60 bg-red-900/30 px-4 py-3 text-sm text-red-200">
            <div className="font-medium">Something went wrong</div>
            <div className="mt-1 text-red-300/90">{error}</div>
            <Tooltip
              stages={tipStages(
                "Dismiss error",
                "Clears this error banner. The underlying problem isn't retried — re-run the action that failed if you want another attempt.",
              )}
            >
              <button
                type="button"
                className="mt-2 text-xs text-red-200 hover:text-white underline underline-offset-2"
                onClick={() => setError(null)}
              >
                Dismiss
              </button>
            </Tooltip>
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
              description="Use the panel on the right to create your first project or import a pack."
              tutorial="home-intro"
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-2">
              {projects.map((p) => {
                const isCurrent = p.id === currentProjectId;
                const isMostRecent =
                  !isCurrent && p.id === mostRecent?.id;
                return (
                  <ProjectCard
                    key={p.id}
                    project={p}
                    highlight={isMostRecent}
                    current={isCurrent}
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
            {/* Side-by-side primary actions. The two buttons share the
                row equally via `flex-1` so the layout reads as a pair of
                co-equal entry points (Create vs Open) rather than a
                primary + afterthought. */}
            <div className="flex gap-2">
              <Tooltip
                stages={tipStages(
                  "New project",
                  "Opens the project setup dialog — pick a starter template, name your project, and Cardboard seeds it locally in IndexedDB.",
                )}
              >
                <Button
                  variant="primary"
                  className="flex-1"
                  onClick={() => setCreateOpen(true)}
                  disabled={busy !== null}
                  leadingIcon={<Plus size={14} />}
                >
                  New project
                </Button>
              </Tooltip>
              <Tooltip
                stages={tipStages(
                  "Open pack from URL",
                  "Fetches a .apg pack from a URL and imports it as a new local project. Optional SHA-256 pin verifies integrity before import.",
                )}
              >
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => setUrlOpen(true)}
                  disabled={busy !== null}
                  leadingIcon={<LinkIcon size={14} />}
                >
                  Open URL
                </Button>
              </Tooltip>
            </div>
            <FilePicker
              mode="dropzone"
              accept=".apg,application/zip"
              onFiles={(files) => files[0] && handleImportFile(files[0])}
              disabled={busy !== null}
              className="min-h-[140px]"
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
            <Tooltip
              stages={tipStages(
                "Editor settings",
                "Editor settings are only reachable from the gear icon in the top bar. This row is a stub reminder while a dedicated entry point lands.",
              )}
            >
              <button
                type="button"
                disabled
                className={cn(
                  "flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs",
                  "text-zinc-500 cursor-not-allowed",
                )}
              >
                <Settings size={14} />
                Editor settings (use top-bar gear)
              </button>
            </Tooltip>
          </CardContent>
        </Card>
      </aside>

      {/* Create-project dialog. */}
      <CreateProjectModal
        open={createOpen}
        busy={busy === "create"}
        onClose={() => {
          if (busy === "create") return;
          setCreateOpen(false);
        }}
        onCreate={handleCreate}
        nameTaken={nameTaken}
      />

      {/* URL-import dialog. */}
      <Modal
        open={urlOpen}
        onClose={() => {
          if (busy === "import-url") return;
          setUrlOpen(false);
          setUrlConfirmed(false);
        }}
        title="Open pack from URL"
        width="md"
        footer={
          <>
            <Tooltip
              stages={tipStages(
                "Cancel",
                "Closes this dialog without importing. Any URL or hash you typed is discarded.",
              )}
            >
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
            </Tooltip>
            <Tooltip
              stages={tipStages(
                "Open pack",
                "Downloads the pack from the URL, optionally verifies its SHA-256, and imports it as a new local project.",
              )}
            >
              <Button
                variant="primary"
                disabled={
                  busy === "import-url" || !urlInput.trim() || !urlConfirmed
                }
                onClick={handleImportUrl}
              >
                {busy === "import-url" ? "Fetching…" : "Open"}
              </Button>
            </Tooltip>
          </>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="pack-url" className="section-eyebrow block">
              Pack URL
            </label>
            <TextInput
              id="pack-url"
              placeholder="https://example.com/cool-pack.apg"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              disabled={busy === "import-url"}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="pack-hash" className="section-eyebrow block">
              SHA-256 (optional)
            </label>
            <TextInput
              id="pack-hash"
              placeholder="paste hex or sha256-… to pin integrity"
              className="font-mono"
              value={hashInput}
              onChange={(e) => setHashInput(e.target.value)}
              disabled={busy === "import-url"}
            />
            <p className="text-xs text-zinc-500">
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
/* CreateProjectModal                                                    */
/* -------------------------------------------------------------------- */

interface CreateProjectModalProps {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onCreate: (
    name: string,
    template: (typeof STARTER_TEMPLATES)[number],
    description: string,
  ) => void | Promise<void>;
  /** Returns true if a project with this (case-insensitive) name already exists. */
  nameTaken: (candidate: string) => boolean;
}

/**
 * Project-setup dialog opened by the "New project" button. Collects:
 *   - name (required, unique among existing projects)
 *   - template (required, pick one from STARTER_TEMPLATES)
 *   - description (optional, free-form)
 *
 * The first template is selected by default. Name validation is
 * inline (empty + duplicate detection); template selection is always
 * non-null thanks to the default, so the only blocking error is
 * name-empty / name-duplicate.
 */
function CreateProjectModal({
  open,
  busy,
  onClose,
  onCreate,
  nameTaken,
}: CreateProjectModalProps) {
  const [name, setName] = React.useState("Untitled project");
  const [templateId, setTemplateId] = React.useState<string>(
    STARTER_TEMPLATES[0]!.id,
  );
  const [description, setDescription] = React.useState("");

  // Reset every time the dialog opens so subsequent creations don't
  // start with the previous payload pre-filled.
  React.useEffect(() => {
    if (open) {
      setName("Untitled project");
      setTemplateId(STARTER_TEMPLATES[0]!.id);
      setDescription("");
    }
  }, [open]);

  const trimmed = name.trim();
  const isEmpty = trimmed.length === 0;
  const isDuplicate = !isEmpty && nameTaken(trimmed);
  const nameError = isEmpty
    ? "Project name is required."
    : isDuplicate
      ? "A project with this name already exists."
      : null;

  const selectedTemplate =
    STARTER_TEMPLATES.find((t) => t.id === templateId) ?? STARTER_TEMPLATES[0]!;

  const canSubmit = !busy && !nameError;

  const handleSubmit = () => {
    if (!canSubmit) return;
    void onCreate(trimmed, selectedTemplate, description.trim());
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New project"
      description="Pick a starter and name your project — assets stay local."
      width="lg"
      dismissOnBackdrop={!busy}
      dismissOnEsc={!busy}
      footer={
        <>
          <Tooltip
            stages={tipStages(
              "Cancel",
              "Closes the new-project dialog without creating anything.",
            )}
          >
            <Button variant="ghost" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
          </Tooltip>
          <Tooltip
            stages={tipStages(
              "Create project",
              "Creates the project locally in IndexedDB using the selected template, then opens it in the editor.",
            )}
          >
            <Button
              variant="primary"
              disabled={!canSubmit}
              onClick={handleSubmit}
            >
              {busy ? "Creating…" : "Create"}
            </Button>
          </Tooltip>
        </>
      }
    >
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
      >
        {/* Name */}
        <div className="space-y-1.5">
          <label htmlFor="create-name" className="section-eyebrow block">
            Project name
          </label>
          <TextInput
            id="create-name"
            placeholder="Untitled project"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
            invalid={Boolean(nameError) && !isEmpty}
            autoFocus
          />
          {nameError && !isEmpty ? (
            <p className="text-xs text-red-400">{nameError}</p>
          ) : (
            <p className="text-xs text-zinc-500">
              Must be unique across your local projects.
            </p>
          )}
        </div>

        {/* Template picker */}
        <div className="space-y-2">
          <span className="section-eyebrow block">Template</span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {STARTER_TEMPLATES.map((t) => {
              const active = t.id === templateId;
              return (
                <TemplateCard
                  key={t.id}
                  template={t}
                  active={active}
                  disabled={busy}
                  onSelect={() => setTemplateId(t.id)}
                />
              );
            })}
          </div>
        </div>

        {/* Description (optional) */}
        <div className="space-y-1.5">
          <label htmlFor="create-desc" className="section-eyebrow block">
            Description <span className="text-zinc-600">(optional)</span>
          </label>
          <Textarea
            id="create-desc"
            placeholder="What is this project about?"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={busy}
          />
        </div>
      </form>
    </Modal>
  );
}

/* -------------------------------------------------------------------- */
/* TemplateCard — selectable starter-template tile                       */
/* -------------------------------------------------------------------- */

interface TemplateCardProps {
  template: (typeof STARTER_TEMPLATES)[number];
  active: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

function TemplateCard({
  template,
  active,
  disabled = false,
  onSelect,
}: TemplateCardProps) {
  return (
    <Tooltip
      stages={tipStages(
        template.displayName,
        template.description,
      )}
    >
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "card-surface-elev text-left p-3 relative",
        "transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400",
        !disabled && !active && "hover:border-zinc-700",
        active && "border-amber-500/60 ring-1 ring-amber-500/40",
        disabled && "opacity-60 cursor-not-allowed",
      )}
    >
      {/* Optional preview thumbnail strip. */}
      {template.thumbnail ? (
        <div className="aspect-video w-full rounded-md overflow-hidden bg-zinc-950 border border-zinc-800 mb-3">
          <img
            src={template.thumbnail}
            alt=""
            className="w-full h-full object-cover"
            draggable={false}
          />
        </div>
      ) : (
        <div
          className="aspect-video w-full rounded-md overflow-hidden border border-zinc-800 mb-3 flex items-center justify-center text-zinc-700"
          style={{
            background: active
              ? "radial-gradient(circle at 30% 30%, rgba(245, 158, 11, 0.25), rgba(8, 9, 11, 0.95) 65%)"
              : "radial-gradient(circle at 30% 30%, rgba(63, 63, 70, 0.6), rgba(8, 9, 11, 0.95) 65%)",
          }}
          aria-hidden="true"
        >
          <Sparkles size={22} />
        </div>
      )}

      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-semibold text-zinc-100 truncate">
          {template.displayName}
        </div>
        {active ? (
          <span
            className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-500 text-zinc-950 shrink-0"
            aria-hidden="true"
          >
            <Check size={12} />
          </span>
        ) : null}
      </div>
      <p className="text-[11px] text-zinc-500 mt-1 leading-relaxed">
        {template.description}
      </p>
    </button>
    </Tooltip>
  );
}

/* -------------------------------------------------------------------- */
/* ProjectCard                                                           */
/* -------------------------------------------------------------------- */

interface ProjectCardProps {
  project: ProjectMeta;
  highlight: boolean;
  /** True when this card represents the project carried in the URL
   *  hash. Renders with a stronger amber accent (left rail + ring) so
   *  it visually wins over the "most recent" highlight. */
  current?: boolean;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}

function ProjectCard({
  project,
  highlight,
  current = false,
  onOpen,
  onRename,
  onDelete,
}: ProjectCardProps) {
  return (
    <div
      aria-current={current ? "true" : undefined}
      className={cn(
        "group relative rounded-lg border bg-zinc-950/40 overflow-hidden",
        "transition-colors",
        current
          ? "border-amber-400 bg-amber-500/[0.08] ring-2 ring-amber-400/40 border-l-4"
          : highlight
            ? "border-amber-500/40 bg-amber-500/[0.04]"
            : "border-zinc-800 hover:border-zinc-700",
      )}
    >
      {/* Thumbnail — 16:9 region. */}
      {/* WIRING: replace placeholder with EditorProjectStore.getProjectThumbnail(id).
          The bake step (Project tab in R4f) writes a PNG into IDB; the
          Home view should `<img>` it when present and fall back to this
          radial-gradient placeholder otherwise. */}
      <Tooltip
        stages={tipStages(
          `Open ${project.name}`,
          `Switches to the ${project.name} project and opens the scene editor. ${current ? "This is your current project." : highlight ? "Most recently modified project." : `Last updated ${formatRelative(project.modifiedAt)}.`}`,
        )}
      >
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
        {current ? (
          <div className="absolute top-2 left-2">
            <Badge variant="amber">Current</Badge>
          </div>
        ) : highlight ? (
          <div className="absolute top-2 left-2">
            <Badge variant="amber">Most recent</Badge>
          </div>
        ) : null}
        <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-amber-500 text-zinc-950 shadow-lg">
            <Play size={16} aria-hidden="true" />
          </span>
        </div>
      </button>
      </Tooltip>

      <div className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <Tooltip
            stages={tipStages(
              `Open ${project.name}`,
              `Switches to the ${project.name} project and opens the scene editor.`,
            )}
          >
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
          </Tooltip>
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
            <IconButton
              icon={<Pencil size={14} />}
              tooltip="Rename project"
              description={`Renames "${project.name}". The new name must be unique across your local projects.`}
              variant="ghost"
              onClick={onRename}
            />
            <IconButton
              icon={<Trash2 size={14} />}
              tooltip="Delete project"
              description={`Permanently removes "${project.name}" and all its assets from your browser's IndexedDB. This cannot be undone.`}
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
                <Tooltip
                  stages={tipStages(
                    "URL import",
                    `Imported from ${project.forkedFrom.url}`,
                  )}
                >
                  <span>URL import</span>
                </Tooltip>
              ) : project.sourcePackId ? (
                <Tooltip
                  stages={tipStages(
                    "Pack fork",
                    `Forked from pack ${project.sourcePackId}`,
                  )}
                >
                  <span>Pack fork</span>
                </Tooltip>
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
    <Tooltip
      stages={tipStages(
        label,
        `Opens ${href} in a new tab.`,
      )}
    >
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
    </Tooltip>
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
