import React, { useEffect, useState } from "react";
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
  CardDescription,
  Input,
  Label,
  Modal,
} from "../components/ui";
import { cn } from "../lib/cn";

/**
 * Home screen — project list + create / import actions.
 *
 * EDITOR.md §10 E1 calls for: list / create / rename / delete plus
 * import .apg from file and (folded in from E6+) open from URL.
 *
 * Layout: two top-level cards side by side.
 *   - Recent projects (left): clickable rows; rename + delete inline.
 *   - Create / Import (right): three stacked actions.
 */

interface HomeScreenProps {
  onOpenProject: (id: string) => void;
}

export function HomeScreen({ onOpenProject }: HomeScreenProps) {
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // URL-import dialog state.
  const [urlOpen, setUrlOpen] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [hashInput, setHashInput] = useState("");
  const [urlConfirmed, setUrlConfirmed] = useState(false);

  const refreshProjects = async () => {
    setLoading(true);
    try {
      const list = await EditorProjectStore.listProjects();
      setProjects(list);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshProjects();
  }, []);

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

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-8 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">
            <span className="text-amber-400">cardboard</span>{" "}
            <span className="text-zinc-400 font-normal">editor</span>
          </h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            In-browser level + pack authoring tool
          </p>
        </div>
        <a
          href="https://github.com/codingbutter/two_5_d"
          target="_blank"
          rel="noreferrer noopener"
          className="text-xs text-zinc-400 hover:text-amber-400 transition-colors"
        >
          GitHub →
        </a>
      </header>

      <main className="px-8 py-10 max-w-6xl mx-auto">
        {error ? (
          <div className="mb-6 rounded-md border border-red-700 bg-red-900/30 px-4 py-3 text-sm text-red-200">
            <div className="font-medium">Something went wrong</div>
            <div className="mt-1 text-red-300/90">{error}</div>
            <button
              className="mt-2 text-xs text-red-200 hover:text-white underline underline-offset-2"
              onClick={() => setError(null)}
            >
              Dismiss
            </button>
          </div>
        ) : null}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Recent projects</CardTitle>
              <CardDescription>
                {loading
                  ? "Loading…"
                  : projects.length === 0
                    ? "No projects yet — create one or import a pack."
                    : `${projects.length} project${projects.length === 1 ? "" : "s"} in this browser.`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {projects.length === 0 ? (
                <div className="text-sm text-zinc-500 py-6 text-center">
                  Your projects live in this browser's IndexedDB storage.
                  Nothing is uploaded anywhere.
                </div>
              ) : (
                <ul className="divide-y divide-zinc-800">
                  {projects.map((p) => (
                    <li
                      key={p.id}
                      className={cn(
                        "py-3 flex items-center justify-between group",
                        "hover:bg-zinc-800/40 -mx-3 px-3 rounded-md",
                      )}
                    >
                      <button
                        className="text-left flex-1"
                        onClick={() => onOpenProject(p.id)}
                      >
                        <div className="font-medium text-zinc-100">
                          {p.name}
                        </div>
                        <div className="text-xs text-zinc-500 mt-0.5">
                          Updated{" "}
                          {new Date(p.modifiedAt).toLocaleString()}
                          {p.forkedFrom?.url ? (
                            <>
                              {" · "}
                              <span title={p.forkedFrom.url}>
                                forked from URL
                              </span>
                            </>
                          ) : null}
                        </div>
                      </button>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleRename(p.id, p.name)}
                        >
                          Rename
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-400 hover:bg-red-900/30 hover:text-red-200"
                          onClick={() => handleDelete(p.id, p.name)}
                        >
                          Delete
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Create or import</CardTitle>
              <CardDescription>
                Start a fresh project or load an existing pack.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button
                variant="primary"
                className="w-full"
                onClick={handleCreate}
                disabled={busy !== null}
              >
                New empty project
              </Button>

              <label
                className={cn(
                  "block w-full cursor-pointer rounded-md border border-zinc-700 bg-zinc-800",
                  "px-4 py-2 text-sm text-zinc-100 text-center hover:bg-zinc-700 transition-colors",
                  busy !== null && "opacity-60 cursor-not-allowed",
                )}
              >
                {busy === "import-file"
                  ? "Importing…"
                  : "Import .apg from file"}
                <input
                  type="file"
                  accept=".apg,application/zip"
                  className="hidden"
                  disabled={busy !== null}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleImportFile(file);
                    e.target.value = "";
                  }}
                />
              </label>

              <Button
                variant="secondary"
                className="w-full"
                onClick={() => setUrlOpen(true)}
                disabled={busy !== null}
              >
                Open URL pack
              </Button>

              <p className="text-xs text-zinc-500 leading-relaxed mt-2">
                Everything stays in this browser. Use <strong>Export</strong>{" "}
                later to share a project as a standalone <code>.apg</code>.
              </p>
            </CardContent>
          </Card>
        </div>
      </main>

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
              I understand this pack is from an unverified source. It will be
              loaded into my local editor.
            </span>
          </label>
        </div>
      </Modal>
    </div>
  );
}
