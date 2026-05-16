# Lighting → Entities refactor

**Status (2026-05-16):** R1 (scene `entities[]` + legacy `lights[]`
→ entity expansion) shipped as part of ENGINE_PACK_SPLIT R1. R2
(`Named` component + `api.world.findByName`) also shipped — see
[ENGINE_PACK_SPLIT.md](./ENGINE_PACK_SPLIT.md). R3 (`Emissive` +
`Anchored` components) and R4 (`Path` + `AnimateEmissive` systems +
demo) remain. This doc stays the source-of-truth for R3+R4.

Migrate lights and emissives from a mix of static-JSON / surface-fields /
ECS-components into a uniform "everything is an entity" model. Authoring,
mods, the bake, and the runtime all read the same source of truth.

Audit basis: `LIGHTING_OVERHAUL.md` (full spec), `SESSION_STATE.md`
(Phases 1–5 shipped, Phase 6 pending). The plan below is meant to fit
in <2 agent sessions.

---

## 1. Current state (post-R1/R2 — 2026-05-16)

R1 + R2 of this plan **shipped as part of ENGINE_PACK_SPLIT R1**.
Today's reality:

- Scenes carry an `entities[]` array
  (`packages/engine/src/Scene.ts`). The legacy `scene.lights[]`
  shorthand is auto-expanded into `entities[]` with `Position +
  Light` components at load time, so the rest of the pipeline only
  sees entities.
- `world.findByName` exists (`packages/engine/src/ECS/World.ts`) +
  is exposed on the ModAPI as `api.world.findByName`. Static lights
  declared with `name` in scene JSON are addressable by mods.
- The bake (`packages/engine/src/Lighting/Bake.ts`) walks the
  expanded `entities[]` for `Light + Position` rows — both
  scene-declared and legacy-`lights[]`-derived.

What remains:

- **Emissive surfaces** are still per-surface data fields on
  `WallSegment.emissive`, `FloorData.emissive`,
  `CeilingData.emissive`. The bake synthesises 3×3 point-light
  grids; the renderer adds emissive RGB to the surface pixel.
  These are NOT yet entities — R3 below addresses that.
- **No `Path` or `AnimateEmissive` systems exist** in
  `packages/engine/src/Systems/`. R4's demo (a torch following a
  scripted path; a rune pulsing) hasn't been built.

---

## 2. Gap analysis

| User request | Status |
|---|---|
| "Lights should be entities" | **Partly.** Dynamic lights yes (`Light` component). Static `scene.lights[]` and emissive surfaces are not entities. |
| "Attach components and scripts to lights" | **Partly.** Possible for dynamic lights only — a mod can `world.add(entity, AnyComponent, …)`. No way to do this for a static scene-authored light. No way at all for emissive surfaces. |
| "Name entities in the scene file" | **Not met.** Scene JSON has no entity declarations. Mods spawn entities by code; nothing in `Scene.ts` or `SceneJSON` knows about names. |
| "Emissive should be a component" | **Not met.** Today `EmissiveSpec` is a surface field on geometry. The bake special-cases it; the runtime special-cases it. Nothing else can attach a script to "the glowing wall tile". |
| "Path component to animate position/intensity" | **Not met.** Trivial once lights are entities — but the static ones can't carry components, so the feature has nowhere to land for authored lights. |

The vision is largely orthogonal to the current pipeline: dynamic
already-works because it uses the ECS; static/emissive don't because
they bypassed it.

---

## 3. Proposed architecture

Three concrete additions, each independently shippable.

### A. Scene JSON gets `entities[]`

```jsonc
{
  "entities": [
    {
      "name": "torch_north",
      "components": {
        "Position": { "x": 5.5, "y": 4.5 },
        "Light":    { "color": [1, 0.85, 0.6], "intensity": 2, "radius": 8, "z": 0.7 }
      }
    }
  ],
  "walls": [...], "floors": [...], "ceilings": [...]
}
```

Extend `Scene.fromJSON` (`Scene.ts:592`) to parse the list into
`SceneEntityDecl[]`. `Game` (`Game.ts:113-117`) spawns them into the
`World` BEFORE `runPackScripts` so mods see them and decorate by name.
Component lookup reuses the ModAPI registry (`ModAPI.ts:165-170`);
unknown names warn and skip.

### B. Static lights become entities

`scene.lights[]` is retained as authoring shorthand. At load time, each
entry expands into a `Position + Light` entity in `scene.entities[]`
before any other processing — exactly like `legacyFullWall` does for
walls (`Scene.ts:212-223`). After that one transformation, the rest of
the pipeline only knows about entities.

**Crucial: the bake now reads entities, not `lights[]`.** Change
`bakeScene` (`bake-lights.ts:121`) to:

1. Apply the same legacy-`lights[]` → entities expansion.
2. Walk `scene.entities[]` for entries carrying `Light + Position`.
3. Combine with auto-spawned emissive lights as today.

### C. Emissive becomes a component

Add an `Emissive` component:

```ts
// Components.ts (next to Light)
export interface EmissiveData {
  color: [number, number, number];
  intensity: number;
  /** Default true — bake contributes; runtime always self-illuminates. */
  areaLight?: boolean;
}
export const Emissive = new Component<EmissiveData>("Emissive");
```

Plus an **`Anchored`** component for emissive entities tied to a surface
cell (so the bake knows owner-cell + which face/layer):

```ts
export interface AnchoredData {
  cell: { x: number; y: number };
  surface: "floor" | "ceiling" | "wall";
  /** Wall-only — face + U range, mirrors `WallSegment`. */
  face?: "N" | "S" | "E" | "W";
  startU?: number; widthU?: number;
  /** For wall sources only; defaults to the segment's z midrange. */
  startZ?: number; height?: number;
}
export const Anchored = new Component<AnchoredData>("Anchored");
```

Authoring shorthand stays — surfaces keep `emissive: { color, intensity }`
in JSON. `Scene.fromJSON` auto-expands each occurrence into an `entities[]`
entry with `{ Anchored, Emissive }` before bake/runtime sees the scene.
Both renderers and the bake stop reading `surface.emissive` directly and
instead query the world / declared-entity list for the `Anchored` +
`Emissive` pair for each cell.

This unifies the three buckets: authoring is unchanged, but the *only*
thing the bake and renderers consume is entities.

---

## 4. Bake-vs-runtime split

**Hard constraint:** the bake runs at `bun run build-packs` time, in
Bun, with no DOM, no `World` instance, no pack-script execution.
Mod-spawned entities CANNOT contribute to the baked lightmap.

Three options:

1. **Only scene-declared entities bake.** `scene.entities[]` plus
   auto-expansions from `lights[]` / surface emissives. Mod-spawned
   lights stay runtime-only (existing dynamic-light path).
2. Run a subset of pack scripts at bake time. Risky — scripts touch
   `window`, fetch, the canvas. Sandboxing is a rathole.
3. Two-pass mods: a build-time entity-spawn hook plus the runtime
   pass. Doubles the ModAPI; authors must reason about which pass.

**Recommend (1).** Matches how the rest of the bake works
(geometry-only), keeps the ModAPI small, and explains itself in one
sentence: "if a light should bake, declare it in the scene file."
Animated intensity/position go through the dynamic path, which is
already lit per-frame.

---

## 5. Migration path

### Phase R1 — `entities[]` plumbing + legacy expansion — ✅ Shipped (via ENGINE_PACK_SPLIT R1)

1. Add `SceneJSON.entities?: SceneEntityDecl[]`; expose
   `Scene.entities` as parsed data.
2. In `Scene.fromJSON`, expand legacy `scene.lights[]` into
   `entities[]` with `Position + Light`.
3. In `Game.ts` before `runPackScripts`, spawn `scene.entities` into
   the `World` via the component registry.
4. Refactor `bakeScene` to read `scene.entities[]` after legacy
   expansion. Existing scenes bake unchanged.

No mod-API changes; no new components. After R1 nothing visually
differs — but lights live in the world.

### Phase R2 — naming + `findByName` — ✅ Shipped (via ENGINE_PACK_SPLIT R1)

1. `SceneEntityDecl.name?: string`. Stored on a new `Named` component
   (`{ name: string }`) when present.
2. Add `world.findByName(name: string): Entity | undefined` (or its
   plural — see open questions). Expose on `ModAPI` as
   `api.world.findByName`.
3. Mods can now `api.world.findByName("torch_north")` and attach
   `Path`, `AnimateEmissive`, custom scripts, etc.

### Phase R3 — `Emissive` + `Anchored` components — ⏳ Pending

1. Add `Emissive` and `Anchored` components in `Components.ts`.
2. In `Scene.fromJSON`, expand every `WallSegment.emissive` /
   `FloorData.emissive` / `CeilingData.emissive` into an
   `entities[]` entry with `{ Anchored, Emissive, Position }`.
3. Refactor `collectEmissiveLights` (`bake-lights.ts:324`) to walk
   `scene.entities[]` looking for `Anchored + Emissive` pairs instead
   of grid surfaces.
4. Refactor renderers' "add emissive RGB" path to query the world /
   declared entities by anchored-cell lookup, not `cell.floor.emissive`.

### Phase R4 — `Path` + `AnimateEmissive` systems + demo — ⏳ Pending

1. Add `Path` component (waypoints + speed + loop flag) and a
   `PathFollowSystem` that mutates `Position`.
2. Add `AnimateEmissive` component (e.g. `{ baseIntensity, amplitude,
   frequency }`) and a system that mutates `Emissive.intensity`.
3. In `scene_heights_demo.json`, name one torch and one ceiling rune;
   in `hello.js`, attach `Path` / `AnimateEmissive` to them via
   `findByName`. Acceptance test: the orbit currently hard-coded in
   `hello.js:131-194` becomes a Path attached to a scene-declared
   light.

---

## 6. Files to touch

**R1 (shipped)** — see `packages/engine/src/Scene.ts`,
`packages/engine/src/Game.ts`, `packages/engine/src/Lighting/Bake.ts`
(callsite `apps/pack-builder/src/build-packs.ts`).

**R2 (shipped)** — see `packages/engine/src/Components/` for
`Named`, `packages/engine/src/ECS/World.ts` for `findByName`, and
`packages/engine/src/ModAPI/` for the surface.

**R3 (pending)**
- `packages/engine/src/Components/` — `Emissive`, `Anchored` (new).
- `packages/engine/src/Scene.ts` — emissive-surface → entity expansion.
- `packages/engine/src/Lighting/Bake.ts` — `collectEmissiveLights`
  reads entities.
- `packages/engine/src/Renderers/TwoDRenderer.ts`,
  `packages/engine/src/Renderers/WebGLRenderer.ts` — emissive
  lookup by anchored cell (cache per scene load).

**R4 (pending)**
- `packages/engine/src/Components/` — `Path`, `AnimateEmissive` (new).
- `packages/engine/src/Systems/PathFollowSystem.ts` (NEW).
- `packages/engine/src/Systems/AnimateEmissiveSystem.ts` (NEW) — or
  a single `LightAnimationSystem` if the patterns generalise.
- `packages/engine/src/Game.ts` — register the new systems.
- `packages/default-pack/scenes/scene_heights_demo.json`,
  `packages/default-pack/scripts/hello.js` — demo.

---

## 7. Open questions

1. **`findByName` — singular, plural, or both?** Return first match
   (warn on dupes), always an array, or ship both `findByName` +
   `findAllByName`?
2. **Component registry timing.** Scene entities load before pack
   scripts run. Do we (a) restrict scene-declared components to
   built-ins, (b) defer unknown fields until a mod registers them, or
   (c) require a `precomponents.js` that runs before scene load?
3. **Bake contract for mods.** Confirm § 4 option (1) — mod-spawned
   entities never bake? Or want a declarative "static-entities" mod
   hook that runs at bake time?
4. **Wall emissive granularity.** One `Anchored` entity per
   `WallSegment` (clean) or per cell with a segment list (cheaper)?

---

## 8. Verdict

The current implementation **partly** meets the entities-first vision:
dynamic lights are full ECS citizens; static lights and emissive
surfaces are not. The refactor unifies all three buckets onto one
authoring shape (`entities[]`) and one runtime shape (`Light` /
`Emissive + Anchored` components), keeping the legacy authoring
shorthands as sugar so no scene file has to change.
