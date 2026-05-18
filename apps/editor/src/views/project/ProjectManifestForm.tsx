import React, { useEffect, useMemo, useState } from "react";
import type { PackManifest } from "@two_5_d/engine";
import type { AssetMeta } from "../../lib/EditorProjectStore";
import {
  Card,
  CardContent,
  Button,
  Input,
  Textarea,
  Label,
} from "../../components/ui";
import {
  PropertyRow,
  Select,
  Badge,
  EmptyState,
  PanelHeader,
  CollapsibleSection,
} from "../../components/ui/index";
import { Scroll, RefreshCw } from "lucide-react";

/**
 * ProjectManifestForm — R4f Project tab → Manifest sub-view.
 *
 * Lifted verbatim from `ProjectSettingsModal.ManifestTab` with the
 * inline labels + raw `<input>` markup swapped for R2 primitives
 * (Card / PropertyRow / Input / Textarea / Select). Field set
 * preserved — every value that round-tripped through the modal still
 * round-trips here.
 */

interface ManifestFormFields {
  id: string;
  name: string;
  version: string;
  engine: string;
  description: string;
  author: string;
  homepage: string;
  license: string;
  startScene: string;
}

function pickFields(m: PackManifest): ManifestFormFields {
  const extra = m as unknown as Record<string, unknown>;
  return {
    id: typeof extra.id === "string" ? extra.id : "",
    name: m.name ?? "",
    version: m.version ?? "",
    engine: m.engine ?? "",
    description:
      typeof extra.description === "string" ? extra.description : "",
    author: typeof extra.author === "string" ? extra.author : "",
    homepage: typeof extra.homepage === "string" ? extra.homepage : "",
    license: typeof extra.license === "string" ? extra.license : "",
    startScene: m.startScene ?? "",
  };
}

function applyFields(m: PackManifest, f: ManifestFormFields): PackManifest {
  const out = { ...m } as PackManifest & Record<string, unknown>;
  out.name = f.name;
  out.version = f.version;
  out.engine = f.engine;
  out.startScene = f.startScene;
  if (f.id) out.id = f.id;
  else delete out.id;
  if (f.description) out.description = f.description;
  else delete out.description;
  if (f.author) out.author = f.author;
  else delete out.author;
  if (f.homepage) out.homepage = f.homepage;
  else delete out.homepage;
  if (f.license) out.license = f.license;
  else delete out.license;
  return out;
}

export interface ProjectManifestFormProps {
  manifest: PackManifest;
  assets: ReadonlyArray<AssetMeta>;
  onSave: (next: PackManifest) => Promise<void>;
  /** Notify parent when draft diverges from saved manifest — drives the
   *  StatusBar "manifest dirty" badge in ProjectTabView. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Exposes the form's save handler so parent EditorActions can flush
   *  the manifest from the TopBar Save button. */
  saveRef?: React.MutableRefObject<(() => Promise<void>) | null>;
}

function fieldsEqual(a: ManifestFormFields, b: ManifestFormFields): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.version === b.version &&
    a.engine === b.engine &&
    a.description === b.description &&
    a.author === b.author &&
    a.homepage === b.homepage &&
    a.license === b.license &&
    a.startScene === b.startScene
  );
}

export function ProjectManifestForm({
  manifest,
  assets,
  onSave,
  onDirtyChange,
  saveRef,
}: ProjectManifestFormProps) {
  const [form, setForm] = useState<ManifestFormFields>(() => pickFields(manifest));
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    setForm(pickFields(manifest));
  }, [manifest]);

  const baseline = useMemo(() => pickFields(manifest), [manifest]);
  const dirty = useMemo(() => !fieldsEqual(form, baseline), [form, baseline]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const sceneAssets = useMemo(
    () => assets.filter((a) => a.path.startsWith("scenes/")),
    [assets],
  );
  // `manifest.scripts[]` was retired in WORLD_STATE "world.json
  // full-scope" (2026-05-17). Scripts now live in
  // `world.json.scripts[]`. The panel keeps the empty-list rendering
  // so the section header doesn't disappear; a follow-up dispatch
  // wires this to read world.json.
  const scriptsList: string[] = [];

  const handleSave = async () => {
    setSaving(true);
    try {
      const next = applyFields(manifest, form);
      await onSave(next);
      setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  };

  // Expose the save handler so the parent's EditorActions registration
  // can call it from the TopBar's Save button.
  useEffect(() => {
    if (!saveRef) return;
    saveRef.current = handleSave;
    return () => {
      saveRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveRef, form, manifest]);

  // Build the scene select's options. Preserve a `(not in pack)` entry
  // if the manifest currently points at a missing scene, so the user
  // can see + correct the dangling reference instead of having it
  // silently disappear.
  const sceneSelectOptions: { value: string; label: string }[] = [];
  if (form.startScene && !sceneAssets.some((s) => s.path === form.startScene)) {
    sceneSelectOptions.push({
      value: form.startScene,
      label: `${form.startScene} (not in pack)`,
    });
  }
  if (sceneAssets.length === 0) {
    sceneSelectOptions.push({ value: "", label: "(no scenes in pack)" });
  } else {
    for (const s of sceneAssets) {
      sceneSelectOptions.push({ value: s.path, label: s.path });
    }
  }

  // "Reload Running Game" footer button (per ProjectSettings.png) —
  // broadcasts a reset message to every reachable iframe (mirrors the
  // `Save & Test` flow used by EntitiesEditor). The button is harmless
  // when no playtest frame is open.
  const handleReloadRunningGame = () => {
    try {
      for (const f of Array.from(window.parent.frames)) {
        try {
          f.postMessage({ type: "reset" }, "*");
        } catch {
          // Frames we don't own throw — ignore.
        }
      }
    } catch {
      // No frame parent — also fine.
    }
  };

  return (
    <div className="space-y-4 max-w-5xl">
      {/* Manifest card — 2-column form layout matches ProjectSettings.png:
       *  left column carries pack identity (id, name, version, engine,
       *  description); right column carries the entry-point scene + the
       *  attribution fields (author, homepage, license).
       */}
      <Card>
        <PanelHeader
          title="Manifest"
          action={
            <>
              {dirty ? (
                <Badge variant="amber" outlined>
                  Dirty
                </Badge>
              ) : (
                <Badge variant="emerald" outlined>
                  Clean
                </Badge>
              )}
              {savedAt ? (
                <span className="text-[11px] text-zinc-500">
                  Saved {new Date(savedAt).toLocaleTimeString()}
                </span>
              ) : null}
            </>
          }
        />
        <CardContent className="pt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-1">
            {/* ── Left column: pack identity ── */}
            <div className="space-y-1 divide-y divide-zinc-800/60">
              <div className="pb-2">
                <Label className="text-[10px] uppercase tracking-wider text-zinc-500">
                  Pack identity
                </Label>
              </div>
              <PropertyRow label="Pack id" stacked hint="Globally unique handle.">
                <Input
                  value={form.id}
                  onChange={(e) => setForm({ ...form, id: e.target.value })}
                  placeholder="my-pack"
                />
              </PropertyRow>
              <PropertyRow label="Name" stacked>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="My Pack"
                />
              </PropertyRow>
              <PropertyRow
                label="Version"
                stacked
                hint="Semver — bump on every export."
              >
                <Input
                  value={form.version}
                  onChange={(e) => setForm({ ...form, version: e.target.value })}
                  placeholder="0.1.0"
                />
              </PropertyRow>
              <PropertyRow
                label="Engine range"
                stacked
                hint="Semver range — '*' means any."
              >
                <Input
                  value={form.engine}
                  onChange={(e) => setForm({ ...form, engine: e.target.value })}
                  placeholder="*"
                />
              </PropertyRow>
              <PropertyRow label="Description" stacked>
                <Textarea
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                  rows={4}
                  placeholder="One-paragraph summary surfaced on the home screen."
                />
              </PropertyRow>
            </div>

            {/* ── Right column: attribution + entry-point ── */}
            <div className="space-y-1 divide-y divide-zinc-800/60">
              <div className="pb-2">
                <Label className="text-[10px] uppercase tracking-wider text-zinc-500">
                  Attribution &amp; entry point
                </Label>
              </div>
              <PropertyRow label="Author" stacked>
                <Input
                  value={form.author}
                  onChange={(e) => setForm({ ...form, author: e.target.value })}
                  placeholder="@codingbutter"
                />
              </PropertyRow>
              <PropertyRow label="Homepage" stacked>
                <Input
                  value={form.homepage}
                  onChange={(e) => setForm({ ...form, homepage: e.target.value })}
                  placeholder="https://…"
                />
              </PropertyRow>
              <PropertyRow
                label="License"
                stacked
                hint="SPDX identifier (e.g. MIT, CC-BY-4.0)."
              >
                <Input
                  value={form.license}
                  onChange={(e) => setForm({ ...form, license: e.target.value })}
                  placeholder="MIT"
                />
              </PropertyRow>
              <PropertyRow label="Start scene" stacked>
                <Select
                  value={form.startScene}
                  onChange={(e) =>
                    setForm({ ...form, startScene: e.target.value })
                  }
                  options={sceneSelectOptions}
                />
              </PropertyRow>
              <div className="pt-3">
                <div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-200/90 leading-relaxed">
                  These settings shape your project&apos;s identity and
                  entry point. Bump the version before exporting an
                  update.
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <CollapsibleSection
        title="Scripts"
        defaultOpen={scriptsList.length > 0}
        trailing={
          scriptsList.length > 0 ? (
            <Badge variant="zinc">{scriptsList.length}</Badge>
          ) : null
        }
      >
        {scriptsList.length === 0 ? (
          <EmptyState
            icon={<Scroll size={26} />}
            title="No manifest scripts"
            description="Add scripts from the Scripts tab — they will appear here once registered."
            tutorial="project-scripts"
          />
        ) : (
          <ul className="rounded border border-zinc-800 bg-zinc-950/40 divide-y divide-zinc-800 text-xs font-mono">
            {scriptsList.map((p) => (
              <li key={p} className="px-3 py-1.5 text-zinc-200">
                {p}
              </li>
            ))}
          </ul>
        )}
      </CollapsibleSection>

      {/* Footer action row — matches the ProjectSettings.png "Reload
       *  Running Game" (left) + Cancel / Done (right) layout. */}
      <div className="flex items-center justify-between gap-3 pt-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={handleReloadRunningGame}
          title="Broadcast a reset to any open playtest frames"
        >
          <RefreshCw size={14} className="mr-1.5" />
          Reload Running Game
        </Button>
        <div className="flex items-center gap-3">
          {savedAt ? (
            <span className="text-xs text-emerald-400">
              Saved {new Date(savedAt).toLocaleTimeString()}
            </span>
          ) : null}
          <Button
            variant="primary"
            size="sm"
            onClick={handleSave}
            disabled={saving || !dirty}
          >
            {saving ? "Saving…" : dirty ? "Save manifest" : "Saved"}
          </Button>
        </div>
      </div>
    </div>
  );
}
