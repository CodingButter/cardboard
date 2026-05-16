'use client';

import { useState } from 'react';

/**
 * Embedded playable game runner with a scene picker.
 *
 * The runner is the static build staged into `public/play/` by the
 * `prebuild` step. We pass both a `pack` URL and a `scene` URL param
 * — the runner respects `scene` if present, otherwise falls back to
 * the pack's `startScene` (currently `scenes/scene1.json`).
 *
 * Extracted to a client component so the otherwise-server-rendered
 * landing page can keep streaming HTML without paying for a full
 * client boundary at the page root. Changing the iframe `src` causes
 * a full game reload — that's expected; the runner doesn't expose a
 * scene-switch API over postMessage yet.
 */

const PLAY_BASE = '/cardboard/play';

type SceneOption = {
  /** Pack-relative scene path passed as the `scene` URL param. */
  value: string;
  /** Human-readable label shown in the dropdown. */
  label: string;
};

const SCENES: SceneOption[] = [
  { value: 'scenes/scene1.json', label: 'Scene 1 — Open Arena' },
  { value: 'scenes/scene2.json', label: 'Scene 2 — Pillared Hall' },
  {
    value: 'scenes/scene3.json',
    label: 'Scene 3 — Heights Demo (Partial Walls + Dynamic Lights)',
  },
  {
    value: 'scenes/scene4.json',
    label: 'Scene 4 — Animation Demo (multi-angle anim_marker)',
  },
];

export function PlayableIframe() {
  const [selectedScene, setSelectedScene] = useState<string>(
    'scenes/scene1.json',
  );

  const src = `${PLAY_BASE}/?pack=${PLAY_BASE}/packs/default.apg&scene=${encodeURIComponent(
    selectedScene,
  )}`;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label
          htmlFor="cardboard-scene-picker"
          className="text-sm font-medium text-fd-foreground"
        >
          Scene:
        </label>
        <select
          id="cardboard-scene-picker"
          value={selectedScene}
          onChange={(e) => setSelectedScene(e.target.value)}
          className="rounded-md border bg-fd-card px-2.5 py-1.5 text-sm text-fd-foreground shadow-sm transition-colors hover:bg-fd-accent/40 focus:outline-none focus:ring-2 focus:ring-fd-primary"
        >
          {SCENES.map((scene) => (
            <option
              key={scene.value}
              value={scene.value}
              className="bg-fd-card text-fd-foreground"
            >
              {scene.label}
            </option>
          ))}
        </select>
        <span className="text-xs text-fd-muted-foreground">
          Switching scenes reloads the runner.
        </span>
      </div>
      <div className="overflow-hidden rounded-xl border bg-black shadow-sm">
        <iframe
          src={src}
          title="cardboard demo"
          allow="pointer-lock; fullscreen; gamepad; screen-wake-lock"
          loading="lazy"
          className="block h-full w-full"
          style={{
            aspectRatio: '16 / 10',
            border: 0,
            width: '100%',
            background: '#0f172a',
          }}
        />
      </div>
    </>
  );
}
