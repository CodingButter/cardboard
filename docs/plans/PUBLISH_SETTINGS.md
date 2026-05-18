# Publish Settings — `.env`-driven publish modes + asset optimization

## Status

| Phase | Topic | State |
|---|---|---|
| **P1** | Pack-builder reads `.env`; `production` mode optimises images + audio via sharp + ffmpeg; tilesheets pixel-preserved | ✅ Landed |
| P2 | Editor reads `.env` defaults + exposes per-project overrides | Pending |
| P3 | Editor Project-Settings panel surfaces every knob with live preview + per-knob "reset to env default" | Pending |
| P4 | CI integration — repo-level `PUBLISH_MODE=production` step for release builds; PR builds stay `development` | Pending |

P1 lives in `apps/pack-builder/`. P2–P4 are documented here for context; the editor follow-up does NOT block on this phase.

## Why

Two pressures collided:

1. **Dev loop speed.** `bun run build-packs` runs on every pack edit. Re-encoding every PNG through `sharp` and every WAV through `ffmpeg` adds seconds to a build that the dev expects to feel instant.
2. **Ship-size discipline.** A finished `.apg` shipped from CI should be as small as we can make it without breaking renderer contracts — but only on a real release build, never in iteration.

The split is mode-flagged via `PUBLISH_MODE` in `apps/pack-builder/.env`:

- `PUBLISH_MODE=development` (default) — byte-for-byte pass-through, no sharp / ffmpeg invocations, fastest possible build. This is what every dev typing `bun run build-packs` hits.
- `PUBLISH_MODE=production` — sharp re-encodes images, ffmpeg re-encodes audio, paths get rewritten where needed (`.wav` → `.mp3`). Suitable for CI release builds; can be flipped locally for a smoke test.

The third pressure — **tilesheet pixel contracts** — drove the image-path split. `manifest.tileSheets[]` entries declare `tileWidth`, `tileHeight`, `cols`, `rows`, `offsetX`, `offsetY` in pixels. Resizing a tilesheet image silently invalidates every per-cell coordinate in the pack, breaking every tile reference at runtime. So tilesheets get their own optimization path: re-encode (quality + quantization knobs), but **never resize**. The builder verifies post-encode that pixel dimensions still match the input; on drift it logs a warning and falls back to the original bytes.

## Schema

`apps/pack-builder/.env.example` is the committed source of truth. Real `.env` files are gitignored (per the root `.gitignore`'s `.env` rule + an explicit `apps/pack-builder/.env` entry for clarity).

| Env var | Type | Default | Description |
|---|---|---|---|
| `PUBLISH_MODE` | `development` \| `production` | `development` | Top-level flag. Unknown values fall back to `development`. |
| `IMAGE_MAX_DIMENSION` | integer (px) | `1024` | Individual images larger than this on their long side are downscaled (aspect preserved). `0` disables. **NOT applied to tilesheets.** |
| `IMAGE_JPEG_QUALITY` | int 1-100 | `85` | JPEG quality for individual images. |
| `IMAGE_PNG_QUANTIZE` | boolean | `true` | Palette-quantize individual PNGs (sharp's `palette: true`). |
| `TILESHEET_JPEG_QUALITY` | int 1-100 | `90` | JPEG quality for tilesheets (higher default — tilesheets often carry fine-grained tile detail). |
| `TILESHEET_PNG_QUANTIZE` | boolean | `false` | Palette-quantize tilesheet PNGs. Default off — tilesheets often need wider colour fidelity than a 256-colour palette gives. |
| `AUDIO_BITRATE` | string | `128k` | ffmpeg `-b:a` flag; passed verbatim. |
| `AUDIO_SAMPLE_RATE` | integer (Hz) | `44100` | ffmpeg `-ar` flag. |

Booleans accept `true|false|1|0|yes|no|on|off` (case-insensitive). Integers parse via `parseInt(value, 10)` with the default substituted on `NaN`.

### Tilesheets vs individual images

The pack-builder identifies tilesheet paths up-front by reading `manifest.tileSheets[].path` into a `Set<string>` per pack. During the emit pass:

- **Tilesheet match** — `optimizeImage(..., role: "tilesheet")` re-encodes with the TILESHEET_* knobs and **never** calls `sharp.resize()`. Post-encode it reads `sharp(out).metadata()` and verifies width/height match the input; on drift it warns + uses the original bytes.
- **No tilesheet match** — `optimizeImage(..., role: "image")` may downscale (aspect preserved) if `max(width, height) > IMAGE_MAX_DIMENSION`, then re-encode with the IMAGE_* knobs.

Other assets (JSON, GLSL, scripts, JSONC) are byte-pass-through in both modes.

### Audio

ffmpeg is invoked via `Bun.spawn`. Inputs are piped via stdin (`pipe:0`), the output format is forced to `mp3` (`-f mp3 pipe:1`), and `-ar` / `-b:a` carry the env-supplied sample-rate / bitrate.

- `.wav` → re-encoded to `.mp3`. The in-zip path is renamed (`.wav` → `.mp3`) and any `manifest.sounds[].file` reference to the old `.wav` path is rewritten before the manifest is zipped.
- `.mp3` → re-encoded in place at the target bitrate / sample rate. No path rename.
- Other audio formats (`.ogg`, `.opus`, `.m4a`, `.flac`) — pass-through. We don't downgrade master sources until the pack-builder grows a richer audio policy.

If `ffmpeg` isn't on `PATH`, the helper logs a one-time warning and returns the original bytes unmodified. The build never hard-fails on a missing tool — production runs in environments that may or may not ship ffmpeg, and a soft degrade is preferable to a CI failure that turns red over a packaging gap.

### Logging contract

At the top of every run:

```
[build-packs] mode=development
```

or

```
[build-packs] mode=production
  image: maxDim=1024, jpegQ=85, pngQuant=true
  tilesheet: jpegQ=90, pngQuant=false
  audio: bitrate=128k, sampleRate=44100
```

Per-pack summary at the end of the run:

```
Cardboard — 43 files, 3,680,539 bytes (pass-through)
```

or

```
Cardboard — 43 files, 1,275,241 bytes
  optimized: 9 image(s) (0 tilesheet(s) pixel-preserved, 4 resized), 2 audio file(s) (1 wav→mp3, 1 mp3 re-encoded)
```

The exact line shape is anchored in the report's smoke output so CI greps stay stable.

## Phases (forward-looking)

### P2 — editor reads `.env` defaults + per-project overrides

Editor's project-settings store gains a `publish` block whose fields default to the env values resolved at editor-start. Per-project overrides ride on top. The editor's "Publish" or "Export" button passes the merged config to the same `loadPublishConfig()` shape the pack-builder uses, so behaviour stays bit-identical between CLI + editor outputs. Cross-ref: `docs/plans/EDITOR_REDESIGN.md` (publish-settings UI lives in the Project view).

### P3 — editor global Publish-Settings panel

A dedicated panel in the editor lets the user dial every knob with a "reset to env default" per row and a "save as project default" / "save as global default" pair at the bottom. Live preview shows the would-be `.apg` size next to the live byte count. Out of scope for P2 but needed before P3.

### P4 — CI integration

GitHub Actions release jobs set `PUBLISH_MODE=production` in the env block of the build step that produces the artifact. PR-build / docs-deploy jobs stay on `development`. This is a no-code-change phase — the pack-builder already reads `process.env` per P1.

## Cross-references

- `docs/PLAN.md` — phase status table; added a row for `PUBLISH_SETTINGS P1`.
- `docs/plans/EDITOR_REDESIGN.md` — Project view is where P2/P3 UI lands.
- `apps/pack-builder/.env.example` — committed source of truth for env knob names + defaults. Modders authoring their own packs copy this to `.env` and tune for their pack.
- `apps/pack-builder/src/publish-config.ts` — P1 implementation: `loadPublishConfig`, `optimizeImage`, `optimizeAudio`, `isImagePath`, `isAudioPath`, `replaceExt`. Used by `build-packs.ts`.
- `apps/pack-builder/src/build-packs.ts` — emit-pass routes image + audio bytes through the helpers in production mode; tilesheet path-set lookup happens immediately after the manifest read.

## Files touched in P1

- `apps/pack-builder/.env.example` — **NEW**, committed.
- `apps/pack-builder/.env` — gitignored; created locally to override per-machine.
- `apps/pack-builder/src/publish-config.ts` — **NEW**. Env parser + `optimizeImage` (sharp) + `optimizeAudio` (Bun.spawn → ffmpeg).
- `apps/pack-builder/src/build-packs.ts` — emit pass routes images + audio through the helpers; manifest emit deferred to post-walk so `.wav` → `.mp3` renames can mirror into `manifest.sounds[].file`.
- `apps/pack-builder/package.json` — added `sharp` dep.
- `.gitignore` — explicit `apps/pack-builder/.env` rule for clarity.
- `packages/default-pack/manifest.json` — `gunshot` sound rewired from `audio/sfx/gunshot.wav` (placeholder) to `audio/sfx/riffle_shot.mp3`; volume nudged 0.6 → 0.5 since the mp3 is hotter than the placeholder square wave.
- `packages/default-pack/audio/sfx/gunshot.wav` — **deleted**. Placeholder.
- `packages/default-pack/sounds/weapons/riffle_shot.mp3` — **deleted**. Orphan dupe.
- `packages/default-pack/sounds/` — **deleted** (now empty).
- `scripts/gen-audio-stubs.ts` — dropped the synthesised `gunshot.wav` stub; only the pickup chime is still synthesised.
- `docs/plans/AUDIO.md` — historical "Files touched" note clarified that the original `gunshot.ogg` plan shipped as `gunshot.wav` and was later replaced by `riffle_shot.mp3`.
