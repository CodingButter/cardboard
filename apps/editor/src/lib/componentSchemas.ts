/**
 * Schema descriptors for the engine's built-in components, used by the
 * editor's schema-driven Inspector forms. EDITOR.md §6.3 + the
 * EntitiesEditor's prefab forms both consume these.
 *
 * Each spec is intentionally minimal — we surface the most-edited
 * fields here, not the full component shape. Power users can drop into
 * the JSON editor for the long tail (modder-defined components fall
 * through to the JSON fallback automatically).
 *
 * Lives in the editor (not the engine) because the field metadata is
 * editor-UI policy (`step`, `min`, `max`, sprite-id auto-complete) —
 * not a runtime engine concern. Keeping it editor-side avoids polluting
 * the engine's component classes with form-rendering hints.
 */

export type ComponentFieldKind =
  | "number"
  | "string"
  | "color3"
  | "boolean"
  | "vec2"
  | "vec3"
  /**
   * Sibling-aware dropdown: choices come from the prefab's Sprite
   * component (specifically, its `imageId` and the manifest's
   * `sprites[imageId].animations`). Rendered as a `<select>` of the
   * sprite's animation names — falls back to a text input when the
   * editor can't resolve the sprite (no Sprite component / no
   * animations on the chosen sprite). Used by `Animation.current`.
   */
  | "animationName";

export interface ComponentFieldSpec {
  /** Field key on the component data. */
  key: string;
  kind: ComponentFieldKind;
  /** Display label — falls back to the key. */
  label?: string;
  /** Inclusive min for number sliders. */
  min?: number;
  /** Inclusive max for number sliders. */
  max?: number;
  /** Step for number sliders. */
  step?: number;
  /** Optional description tooltip. */
  hint?: string;
}

export interface ComponentSchema {
  /** Component name as registered (`Position`, `Light`, ...). */
  name: string;
  fields: ComponentFieldSpec[];
  /** Default data used when adding the component from the picker. */
  defaultData: Record<string, unknown>;
}

/**
 * Built-in component schemas. Cover the components the engine ships in
 * `packages/engine/src/Components/`; modder-defined components fall
 * through to the generic JSON editor.
 */
export const BUILT_IN_COMPONENT_SCHEMAS: ComponentSchema[] = [
  {
    name: "Position",
    fields: [
      { key: "x", kind: "number", step: 0.5, hint: "World x in tile units" },
      { key: "y", kind: "number", step: 0.5, hint: "World y in tile units" },
      { key: "z", kind: "number", step: 0.05, min: 0, max: 2, hint: "Height" },
    ],
    defaultData: { x: 1.5, y: 1.5, z: 0 },
  },
  {
    name: "Light",
    fields: [
      { key: "color", kind: "color3", label: "color (RGB)" },
      { key: "intensity", kind: "number", min: 0, max: 10, step: 0.1 },
      { key: "radius", kind: "number", min: 0, max: 20, step: 0.5 },
      { key: "z", kind: "number", min: 0, max: 2, step: 0.05 },
    ],
    defaultData: { color: [1, 1, 1], intensity: 1, radius: 6, z: 0.5 },
  },
  {
    name: "Facing",
    fields: [
      { key: "angle", kind: "number", step: 0.05, hint: "Radians, CCW from +x" },
    ],
    defaultData: { angle: 0 },
  },
  {
    name: "Movement",
    fields: [
      { key: "speed", kind: "number", min: 0, max: 10, step: 0.1 },
      { key: "rotationSpeed", kind: "number", min: 0, max: 0.05, step: 0.001 },
      { key: "runMultiplier", kind: "number", min: 1, max: 4, step: 0.1 },
    ],
    defaultData: {
      speed: 3,
      rotationSpeed: 0.003,
      runMultiplier: 1.5,
      isRunning: false,
      z: 0,
      vz: 0,
      crouching: false,
    },
  },
  {
    name: "Sprite",
    fields: [
      { key: "imageId", kind: "string", hint: "manifest sprite key" },
      { key: "scale", kind: "number", min: 0.1, max: 8, step: 0.1 },
    ],
    defaultData: { imageId: "", scale: 1 },
  },
  {
    name: "Animation",
    fields: [
      {
        key: "current",
        kind: "animationName",
        label: "current",
        hint: "Animation name from the sprite's `animations` dict",
      },
      {
        key: "frame",
        kind: "number",
        min: 0,
        step: 1,
        hint: "Index into the animation's frames[] array",
      },
      {
        key: "elapsed",
        kind: "number",
        min: 0,
        step: 0.01,
        hint: "Seconds elapsed in the current frame",
      },
      { key: "paused", kind: "boolean" },
      {
        key: "playbackRate",
        kind: "number",
        min: 0,
        max: 4,
        step: 0.1,
        hint: "Multiplier on dt for this entity",
      },
    ],
    defaultData: { current: "", frame: 0, elapsed: 0 },
  },
  {
    name: "Shader",
    fields: [
      { key: "worldHooks", kind: "string", hint: "path/to.glsl" },
      { key: "spriteHooks", kind: "string", hint: "path/to.glsl" },
      { key: "skyHooks", kind: "string", hint: "path/to.glsl" },
    ],
    defaultData: {},
  },
  {
    name: "MinimapMarker",
    fields: [
      { key: "color", kind: "color3" },
      { key: "size", kind: "number", min: 0.1, max: 4, step: 0.1 },
    ],
    defaultData: { color: [1, 1, 1], size: 1 },
  },
  {
    name: "Camera",
    fields: [
      { key: "fov", kind: "number", min: 0.3, max: 2.5, step: 0.05 },
    ],
    defaultData: { fov: Math.PI / 3 },
  },
  {
    name: "Aim",
    fields: [
      { key: "screenY", kind: "number", step: 0.01, hint: "Pitch offset (screen-space)" },
    ],
    defaultData: { screenY: 0 },
  },
  {
    name: "PlayerInput",
    fields: [],
    defaultData: { bindings: {} },
  },
  {
    name: "Weapon",
    fields: [],
    defaultData: { lastFireTime: -100, walkPhase: 0, wasFiring: false, reloadStart: -Infinity },
  },
  {
    name: "Inventory",
    fields: [],
    defaultData: { bag: [], hotbar: [], equipment: {}, activeHotbarIndex: 0 },
  },
  {
    name: "Pickup",
    fields: [
      { key: "itemId", kind: "string", hint: "Item id from manifest.items" },
      { key: "count", kind: "number", min: 1, step: 1 },
    ],
    defaultData: { itemId: "", count: 1 },
  },
];

export function findComponentSchema(name: string): ComponentSchema | undefined {
  return BUILT_IN_COMPONENT_SCHEMAS.find((s) => s.name === name);
}

/** Names of every built-in component the editor knows how to introspect. */
export const BUILT_IN_COMPONENT_NAMES: ReadonlyArray<string> =
  BUILT_IN_COMPONENT_SCHEMAS.map((s) => s.name);
