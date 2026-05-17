import React, { useEffect, useMemo, useState } from "react";
import type { PackManifest } from "@two_5_d/engine";
import type { AssetMeta } from "../../lib/EditorProjectStore";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Input,
  Textarea,
} from "../../components/ui";
import { PropertyRow, Select, Badge, EmptyState } from "../../components/ui/index";
import { Scroll } from "lucide-react";

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
}

export function ProjectManifestForm({
  manifest,
  assets,
  onSave,
}: ProjectManifestFormProps) {
  const [form, setForm] = useState<ManifestFormFields>(() => pickFields(manifest));
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    setForm(pickFields(manifest));
  }, [manifest]);

  const sceneAssets = useMemo(
    () => assets.filter((a) => a.path.startsWith("scenes/")),
    [assets],
  );
  const scriptsList = manifest.scripts ?? [];

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

  return (
    <div className="space-y-4 max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle>Identity</CardTitle>
          <CardDescription>
            Pack metadata that ships with the manifest. The `id` field is
            the globally-unique handle used by the dep resolver — change
            with care.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 divide-y divide-zinc-800/60">
          <PropertyRow label="Pack id" hint="Globally unique handle.">
            <Input
              value={form.id}
              onChange={(e) => setForm({ ...form, id: e.target.value })}
              placeholder="my-pack"
            />
          </PropertyRow>
          <PropertyRow label="Name">
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="My Pack"
            />
          </PropertyRow>
          <PropertyRow label="Version" hint="Semver — bump on every export.">
            <Input
              value={form.version}
              onChange={(e) => setForm({ ...form, version: e.target.value })}
              placeholder="0.1.0"
            />
          </PropertyRow>
          <PropertyRow label="Engine range" hint="Semver range — '*' means any.">
            <Input
              value={form.engine}
              onChange={(e) => setForm({ ...form, engine: e.target.value })}
              placeholder="*"
            />
          </PropertyRow>
          <PropertyRow label="Description" stacked>
            <Textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
              placeholder="One-paragraph summary surfaced on the home screen."
            />
          </PropertyRow>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Attribution</CardTitle>
          <CardDescription>
            Author + license info. Empty fields are stripped from the
            exported manifest.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 divide-y divide-zinc-800/60">
          <PropertyRow label="Author">
            <Input
              value={form.author}
              onChange={(e) => setForm({ ...form, author: e.target.value })}
              placeholder="@codingbutter"
            />
          </PropertyRow>
          <PropertyRow label="Homepage">
            <Input
              value={form.homepage}
              onChange={(e) => setForm({ ...form, homepage: e.target.value })}
              placeholder="https://…"
            />
          </PropertyRow>
          <PropertyRow label="License" hint="SPDX identifier (e.g. MIT, CC-BY-4.0).">
            <Input
              value={form.license}
              onChange={(e) => setForm({ ...form, license: e.target.value })}
              placeholder="MIT"
            />
          </PropertyRow>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Entry point</CardTitle>
          <CardDescription>
            Scene loaded at boot. Drives the Map view's default selection
            and what the runtime renders on cold start.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PropertyRow label="Start scene" stacked>
            <Select
              value={form.startScene}
              onChange={(e) => setForm({ ...form, startScene: e.target.value })}
              options={sceneSelectOptions}
            />
          </PropertyRow>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>Scripts</CardTitle>
              <CardDescription>
                Display-only — script authoring lives in the Scripts tab
                (#193). Listed in load order.
              </CardDescription>
            </div>
            {scriptsList.length > 0 ? (
              <Badge variant="zinc">{scriptsList.length}</Badge>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-3 pt-2">
        {savedAt ? (
          <span className="text-xs text-emerald-400">
            Saved {new Date(savedAt).toLocaleTimeString()}
          </span>
        ) : null}
        <Button variant="primary" size="sm" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save manifest"}
        </Button>
      </div>
    </div>
  );
}
