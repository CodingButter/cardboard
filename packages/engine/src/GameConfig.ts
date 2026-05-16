import rawConfig from "../game.config.json";
import type { IPixel } from "Libs/Geometry";
import type { KeyCode } from "Controllers/KeyboardController";
import { deepMerge } from "./Libs/DeepMerge";

/**
 * Tuneable knobs for the renderer, controls, and HUD. Sourced from
 * `packages/engine/game.config.json`.
 *
 * The interface IS the documentation — JSON has no comment syntax, so the
 * meaning of each value lives here. Edit the JSON to retune; Bun's module
 * HMR will pick up the change on save (next frame uses the new values).
 *
 * Convention: this file holds *tuning*, not structural wiring. Things like
 * the canvas size, the texture-source map, and the tile-sheet specs stay
 * in their respective modules — they're part of the architecture, not
 * dials you'd turn during playtesting.
 */
export interface GameConfig {
  /** Global renderer behavior toggles. */
  rendering: {
    /**
     * Bilinear texture filtering for the **canvas2d** backend. When
     * `true`, every texture sample (walls, floors, ceilings, tiled
     * reflections) blends the 4 nearest texels — smoother but ~3–4×
     * more texture reads per pixel. The `webgl` backend always uses
     * hardware bilinear and ignores this flag.
     */
    bilinearFiltering: boolean;
    /**
     * Which renderer to use:
     *   - `"canvas2d"` — CPU pixel buffer, ~600 LOC of JS. Full feature
     *     coverage (multi-tile, AO bands, all reflections, edge AA).
     *   - `"webgl"` — GPU fragment shader. MVP scope (single texture per
     *     role, distance fog, side darken); reflections / multi-tile /
     *     AO bands still in canvas2d only. Faster on close-up walls and
     *     scales well with resolution.
     *
     * Switching requires a page reload — a canvas can only have one
     * context type (`2d` xor `webgl2`).
     */
    backend: "canvas2d" | "webgl";
    /**
     * Render resolution as a fraction of the window dimensions. `1.0`
     * = native (one rendered pixel per screen pixel). Lower values
     * trade visual quality for perf — e.g. `0.5` on a 4K monitor
     * renders at 1080p then upscales via CSS. Clamped to `[0.25, 1.0]`.
     */
    resolutionScale: number;
  };

  /** Wall-pass tuning. */
  walls: {
    /**
     * Ambient occlusion ramps at the top and bottom of every wall column.
     * Each is a multiplier reached at the very edge (1.0 = no darkening)
     * over a fractional band of the wall's height. Bottom band heavier
     * (grime / floor contact); top band subtler (light spill from ceiling).
     */
    ao: {
      bottomDarken: number;
      bottomBand: number;
      topDarken: number;
      topBand: number;
    };
    /**
     * Wall "gloss" — alpha fades at the top and bottom edges so the
     * floor/ceiling drawn underneath shines through. `strength` is the
     * peak transparency at the very edge; `band` is the fraction of the
     * wall height the ramp covers.
     */
    reflection: {
      strength: number;
      band: number;
    };
    /**
     * Solid color fallback per wall tile id (used while the tile's
     * texture is still loading or if the load fails).
     */
    tileColors: Record<number, IPixel>;
    /** Fallback color when an unknown tile id is referenced. */
    defaultColor: IPixel;
  };

  /** Floor + ceiling pass tuning. */
  floor: {
    /**
     * World-space AO applied to floor/ceiling pixels near wall edges.
     * `band` is the fraction of the cell where AO ramps in toward the
     * wall edge; `darken` is the multiplier reached at the wall.
     */
    ao: {
      band: number;
      darken: number;
    };
    /** Reflection tiling: how many times the reflected texture repeats per cell. */
    reflection: {
      tileScale: number;
    };
  };

  /** Default `Camera` component attached to the player on spawn. */
  camera: {
    /** Horizontal field of view, in degrees. Converted to radians at use. */
    fovDegrees: number;
    /** Sky color (top half of screen, behind walls). */
    ceiling: IPixel;
    /** Floor backdrop color (bottom half of screen). */
    floor: IPixel;
    /** Distance in tile units past which walls fade to black. `Infinity` disables fog. */
    fogDistance: number;
    /** Max DDA cells to walk per wall ray before giving up. */
    maxRaySteps: number;
    /**
     * Fake-pitch strength. The horizon line shifts opposite the reticle
     * by `aim.screenY * pitchFraction` pixels, so looking down (reticle
     * low) moves the horizon up and reveals more floor. `0` disables the
     * effect; `0.3–0.5` gives a Heretic-style subtle pitch; `1` makes
     * the horizon track the reticle 1:1 (extreme).
     */
    pitchFraction: number;
  };

  /** Default `Movement` component values applied to the player on spawn. */
  player: {
    speed: number;
    rotationSpeed: number;
    runMultiplier: number;
    /**
     * Collision radius in tile units. The player is a square of side
     * `2 × radius` centered on `Position`; movement is blocked when any
     * of its four corners enters a wall cell. `0.22` leaves a comfortable
     * gap so the renderer never punches through the wall.
     */
    radius: number;
  };

  /** Default keyboard bindings for `PlayerInput`. */
  bindings: {
    forward: KeyCode[];
    backward: KeyCode[];
    strafeLeft: KeyCode[];
    strafeRight: KeyCode[];
    run: KeyCode[];
    jump: KeyCode[];
    crouch: KeyCode[];
  };

  /** Minimap overlay style + the player's marker styling on it. */
  minimap: {
    /** Linear scale factor (`0.25` = quarter of the canvas's short side). */
    scale: number;
    /**
     * Number of tiles to show in each direction from the player. The
     * minimap is a centered viewport — the player marker stays pinned at
     * the middle and the world scrolls around them. Smaller values =
     * zoomed-in, more detail per tile. Larger values = more of the map
     * visible but tiles get smaller.
     */
    viewRadiusTiles: number;
    style: {
      background: string;
      outline: string;
      wall: string;
      ray: string;
      strokeWidthPx: number;
    };
    playerMarker: {
      color: string;
      radius: number;
    };
  };

  /**
   * Baseline first-person weapon viewmodel tuning. The active weapon's
   * image and any of these per-weapon fields come from the pack's
   * `manifest.items[id].weapon`; anything the manifest leaves out
   * falls back to the values here.
   *
   * Sizes are *fractions of canvas height* (not absolute pixels) so the
   * viewmodel scales with the renderer's resolution — changing `FACTOR`
   * in `Config.ts` no longer makes the gun look comically large or small.
   */
  gun: {
    /** Drawn height as a fraction of canvas height (image is square → also the width). */
    heightFraction: number;
    /**
     * Gap between the reticle and the top of the gun, as a fraction of
     * canvas height. Positive = gun sits below the reticle; negative =
     * gun overlaps upward into the reticle's space (the reticle renders
     * over the gun, so this is the lever for "raise the viewmodel").
     */
    reticleGapFraction: number;
    /** Max horizontal walk-sway, as a fraction of canvas height. */
    swayAmplitudeFraction: number;
    /** Radians/sec the walk-cycle phase advances while a movement key is held. */
    swayFrequency: number;
    /** Seconds for the recoil bump to play out (rise + fall). */
    recoilDuration: number;
    /** Max recoil lift, as a fraction of canvas height. */
    recoilHeightFraction: number;
    /** Max fractional growth during recoil (`0.08` = 8% larger at peak). */
    recoilScale: number;
    /** Max x-skew coefficient during recoil (`0.06` ≈ 6° tilt at peak). */
    recoilSkew: number;
  };

  /** On-screen aim reticle. Stays horizontally centered; tracks mouse Y. */
  reticle: {
    /**
     * URL of a PNG to draw centered on the aim point (transparency
     * supported). When set, the procedural crosshair fields below
     * (`color`/`size`/`gap`/`lineWidth`) are unused. Set to `""` (or
     * remove) to fall back to the procedural crosshair.
     */
    imageUrl: string;
    /** Reticle image size as a fraction of canvas height (square, height × height). */
    imageSizeFraction: number;
    /** Stroke color (any CSS color string). */
    color: string;
    /** Length of each arm of the crosshair, in canvas pixels. */
    size: number;
    /** Gap at the center between the arms — `0` = solid plus. */
    gap: number;
    /** Stroke width in pixels. */
    lineWidth: number;
    /**
     * Mouse-Y → screen-Y multiplier. Tune in tandem with
     * `player.rotationSpeed` so vertical and horizontal feel match.
     */
    sensitivity: number;
    /**
     * `true` to flip the mapping (mouse forward = reticle down). Some
     * players prefer "airplane controls."
     */
    invertY: boolean;
    /**
     * Vertical travel limit, as a fraction of half-canvas-height. `0.4`
     * keeps the reticle within the middle 80% of the canvas.
     */
    maxOffsetFraction: number;
  };

  /** Stats overlay style (toggled by Ctrl+`). */
  stats: {
    background: string;
    text: string;
    font: string;
    lineHeight: number;
    padding: number;
    width: number;
  };

  /**
   * Audio mixer volumes — Au1 of `docs/plans/AUDIO.md` §6.1. Each
   * group has its own gain node feeding `master`; this block drives
   * the live `GainNode.gain.value` updates from the Settings UI. All
   * values are 0..1. A pack that ships no `manifest.sounds` never
   * touches the audio subsystem, so these knobs are inert by default.
   */
  audio: {
    /** Global volume multiplier (0..1). Slider in Settings → Audio. */
    masterVolume: number;
    /** Per-group volumes (0..1). */
    sfxVolume: number;
    musicVolume: number;
    ambientVolume: number;
    voiceVolume: number;
  };

  /**
   * UI scaling — single source of truth for HUD + modal scale.
   *
   * - Engine writes `<html style="font-size: ${16 * scale}px">` so
   *   Tailwind `rem`-relative classes in modals scale automatically.
   * - Pack-side HUD systems (hotbar, minimap, stats, reticle, gun)
   *   read `api.config.ui.scale` and multiply their canvas2d pixel
   *   coords. They're not `rem`-aware because they draw to a canvas.
   *
   * Range: 0.75 – 2.0. Default 1.0 = today's behavior.
   */
  ui: {
    /** Multiplier applied to all UI text + element sizes. */
    scale: number;
  };
}

/**
 * The baseline shipped with the engine. Frozen so a mod can't accidentally
 * mutate it; overrides happen via `applyConfigOverride` which produces a
 * fresh merged object.
 */
const BASELINE: GameConfig = Object.freeze(rawConfig as unknown as GameConfig);

/**
 * The live, typed configuration. Read this from any system or prefab.
 *
 * It's an `export let` so that calling `applyConfigOverride` replaces
 * the binding for every importer. Consumers should NOT destructure or
 * cache `CONFIG.foo` at module-load time — instead, read it inline (or
 * cache at the start of each frame) so pack overrides take effect.
 *
 * The `as unknown as GameConfig` cast trusts the JSON to match the
 * schema. Mismatched fields surface at the consumer's call site.
 */
export let CONFIG: GameConfig = BASELINE;

/**
 * Replace the live `CONFIG` with `baseline ⨁ override`. Called once at
 * startup by `main.ts` after the asset pack's `config.json` has been
 * fetched and parsed. Subsequent calls are valid — they re-merge from
 * baseline, so passing `{}` resets to defaults.
 */
export function applyConfigOverride(override: unknown): void {
  CONFIG = deepMerge<GameConfig>(BASELINE, override);
}
