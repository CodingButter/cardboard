/**
 * Pack-local Prefabs fixtures — P3 prefabs batch.
 *
 * Slimmed copy of `apps/editor/src/views/prefabs/prefabs-fixtures.ts`
 * pulled into the pack so the six migrated Prefabs panels
 * (`ComponentEditorPanel`, `EntityDropZonePanel`, `EntityHeaderPanel`,
 * `EntityListPanel`, `EntityPreviewPanel`, `JsonPreviewPanel`) can
 * import their mock entity data via a pack-relative path rather than
 * reaching back into the editor shell's source tree.
 *
 * Same dogfooding invariant as the `scene-fixtures.ts` sibling: fixtures
 * are PACK CONTENT, not platform surface. The shell SDK never exposes
 * fixture data. The editor-side copy of this file remains in place for
 * the moment because `PrefabsView.tsx` still references `MOCK_ENTITIES`
 * for the per-entity command registry; both copies are kept in sync
 * verbatim and the editor-side file is deleted in the follow-up P4
 * cleanup pass that retires the editor-side view shells.
 *
 * Engine context: "Prefabs" are pack-defined ENTITY DEFINITIONS —
 * reusable templates (Wolfenstein-style enemies / items / triggers /
 * lights) that the Scene canvas instantiates by reference. The Prefabs
 * page is the FORM-HEAVY EDITOR for these templates; the Scene page is
 * where instances are placed. The page is "Prefabs" externally but the
 * in-page domain noun remains "entity" to match the engine's runtime
 * vocabulary.
 *
 * Wave 3 wires these panels to a real `EditorProjectStore` selector
 * surface; at that point both this file and the editor-side copy can be
 * deleted in one go.
 */

// ---------------------------------------------------------------------------
// Component model

export type ComponentKind =
  | "light"
  | "sprite"
  | "movement"
  | "position"
  | "audio"
  | "collider";

export interface ComponentInstance {
  id: string;
  kind: ComponentKind;
  enabled: boolean;
  /** Component-specific data; shape varies per kind. The keys here
   *  correspond 1:1 with `COMPONENT_SCHEMAS[kind].fields[].key`. */
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Entity rows

/** Coarse-grain category used by `EntityListPanel`'s filter chips and
 *  the eyebrow label above each row group. */
export type EntityCategory =
  | "light"
  | "actor"
  | "item"
  | "trigger"
  | "decor";

export interface EntityRow {
  id: string;
  name: string;
  category: EntityCategory;
  description: string;
  /** Free-form tag chips rendered next to the name in
   *  `EntityHeaderPanel`. */
  tags: string[];
  /** Components attached to this entity, in render-order. The
   *  `ComponentEditorPanel` stacks one collapsible card per entry. */
  components: ComponentInstance[];
}

export const MOCK_ENTITIES = [
  {
    id: "light",
    name: "Light",
    category: "light",
    description:
      "A light source for the scene. Use to add atmosphere and visibility.",
    tags: ["light", "atmosphere", "dynamic"],
    components: [
      {
        id: "c-light-light",
        kind: "light",
        enabled: true,
        data: {
          type: "point",
          intensity: 1.5,
          color: "#fbbf24",
          falloff: 0.6,
          shadow: true,
        },
      },
      {
        id: "c-light-sprite",
        kind: "sprite",
        enabled: true,
        data: {
          image: "light-orb.png",
          scale: 1.0,
          fade: 0.8,
          billboard: 1.0,
        },
      },
      {
        id: "c-light-movement",
        kind: "movement",
        enabled: false,
        data: { type: "static", speed: 0 },
      },
      {
        id: "c-light-position",
        kind: "position",
        enabled: true,
        data: { x: 0, y: 0, z: 0 },
      },
    ],
  },
  {
    id: "player",
    name: "Player",
    category: "actor",
    description: "Player-controlled entity. Spawned at the active player-spawn marker.",
    tags: ["player", "actor", "controllable"],
    components: [
      {
        id: "c-player-sprite",
        kind: "sprite",
        enabled: true,
        data: {
          image: "player.png",
          scale: 1.0,
          fade: 1.0,
          billboard: 1.0,
        },
      },
      {
        id: "c-player-movement",
        kind: "movement",
        enabled: true,
        data: { type: "static", speed: 5 },
      },
      {
        id: "c-player-position",
        kind: "position",
        enabled: true,
        data: { x: 0, y: 0, z: 0 },
      },
      {
        id: "c-player-collider",
        kind: "collider",
        enabled: true,
        data: { shape: "capsule", radius: 0.5 },
      },
    ],
  },
  {
    id: "health_point",
    name: "Health Point",
    category: "item",
    description: "Restores a small amount of player health on pickup.",
    tags: ["item", "pickup", "health"],
    components: [
      {
        id: "c-hp-sprite",
        kind: "sprite",
        enabled: true,
        data: {
          image: "health-cross.png",
          scale: 0.6,
          fade: 1.0,
          billboard: 1.0,
        },
      },
      {
        id: "c-hp-position",
        kind: "position",
        enabled: true,
        data: { x: 0, y: 0, z: 0 },
      },
      {
        id: "c-hp-collider",
        kind: "collider",
        enabled: true,
        data: { shape: "sphere", radius: 0.4 },
      },
      {
        id: "c-hp-audio",
        kind: "audio",
        enabled: true,
        data: { clip: "pickup-health.ogg", volume: 0.8, loop: false },
      },
    ],
  },
  {
    id: "enemy",
    name: "Enemy",
    category: "actor",
    description: "Patrolling AI enemy. Engages the player when in line of sight.",
    tags: ["actor", "enemy", "ai", "patrol"],
    components: [
      {
        id: "c-enemy-sprite",
        kind: "sprite",
        enabled: true,
        data: {
          image: "grunt.png",
          scale: 1.0,
          fade: 1.0,
          billboard: 1.0,
        },
      },
      {
        id: "c-enemy-movement",
        kind: "movement",
        enabled: true,
        data: { type: "patrol", speed: 2.5 },
      },
      {
        id: "c-enemy-position",
        kind: "position",
        enabled: true,
        data: { x: 0, y: 0, z: 0 },
      },
      {
        id: "c-enemy-collider",
        kind: "collider",
        enabled: true,
        data: { shape: "capsule", radius: 0.5 },
      },
      {
        id: "c-enemy-audio",
        kind: "audio",
        enabled: true,
        data: { clip: "grunt-alert.ogg", volume: 0.9, loop: false },
      },
    ],
  },
  {
    id: "weapon_pickup",
    name: "Weapon Pickup",
    category: "item",
    description: "Drops a weapon into the player's inventory on touch.",
    tags: ["item", "pickup", "weapon"],
    components: [
      {
        id: "c-weapon-sprite",
        kind: "sprite",
        enabled: true,
        data: {
          image: "shotgun.png",
          scale: 0.8,
          fade: 1.0,
          billboard: 1.0,
        },
      },
      {
        id: "c-weapon-light",
        kind: "light",
        enabled: true,
        data: {
          type: "point",
          intensity: 0.6,
          color: "#fde68a",
          falloff: 0.4,
          shadow: false,
        },
      },
      {
        id: "c-weapon-position",
        kind: "position",
        enabled: true,
        data: { x: 0, y: 0, z: 0 },
      },
      {
        id: "c-weapon-collider",
        kind: "collider",
        enabled: true,
        data: { shape: "box", radius: 0.5 },
      },
    ],
  },
  {
    id: "door_trigger",
    name: "Door Trigger",
    category: "trigger",
    description: "Opens a tagged door when the player enters this volume.",
    tags: ["trigger", "door", "interactive"],
    components: [
      {
        id: "c-door-position",
        kind: "position",
        enabled: true,
        data: { x: 0, y: 0, z: 0 },
      },
      {
        id: "c-door-collider",
        kind: "collider",
        enabled: true,
        data: { shape: "box", radius: 1.0 },
      },
      {
        id: "c-door-audio",
        kind: "audio",
        enabled: true,
        data: { clip: "door-open.ogg", volume: 1.0, loop: false },
      },
    ],
  },
  {
    id: "exit_zone",
    name: "Exit Zone",
    category: "trigger",
    description: "Marks the level-exit volume. Completing the level enters this trigger.",
    tags: ["trigger", "exit", "level-end"],
    components: [
      {
        id: "c-exit-position",
        kind: "position",
        enabled: true,
        data: { x: 0, y: 0, z: 0 },
      },
      {
        id: "c-exit-collider",
        kind: "collider",
        enabled: true,
        data: { shape: "box", radius: 1.5 },
      },
      {
        id: "c-exit-light",
        kind: "light",
        enabled: true,
        data: {
          type: "spot",
          intensity: 3.0,
          color: "#22d3ee",
          falloff: 0.5,
          shadow: false,
        },
      },
    ],
  },
  {
    id: "torch_decor",
    name: "Wall Torch",
    category: "decor",
    description: "Wall-mounted torch with a flickering light. Pure decoration.",
    tags: ["decor", "atmosphere", "light"],
    components: [
      {
        id: "c-torch-sprite",
        kind: "sprite",
        enabled: true,
        data: {
          image: "torch.png",
          scale: 0.8,
          fade: 1.0,
          billboard: 1.0,
        },
      },
      {
        id: "c-torch-light",
        kind: "light",
        enabled: true,
        data: {
          type: "point",
          intensity: 2.0,
          color: "#fb923c",
          falloff: 0.7,
          shadow: true,
        },
      },
      {
        id: "c-torch-position",
        kind: "position",
        enabled: true,
        data: { x: 0, y: 0, z: 0 },
      },
      {
        id: "c-torch-audio",
        kind: "audio",
        enabled: true,
        data: { clip: "torch-loop.ogg", volume: 0.4, loop: true },
      },
    ],
  },
] as const satisfies readonly EntityRow[];

// ---------------------------------------------------------------------------
// Component schemas

export interface ComponentSchemaField {
  key: string;
  label: string;
  type: "number" | "boolean" | "string" | "color" | "select" | "slider";
  description: string;
  defaultValue: unknown;
  /** For `select` fields. */
  options?: string[];
  /** For `slider` / `number` ranges. */
  min?: number;
  max?: number;
  step?: number;
}

export interface ComponentSchema {
  kind: ComponentKind;
  name: string;
  description: string;
  fields: ComponentSchemaField[];
}

export const COMPONENT_SCHEMAS = {
  light: {
    kind: "light",
    name: "Light",
    description:
      "Emits illumination from the entity's position. Pick a light type, color, and falloff.",
    fields: [
      {
        key: "type",
        label: "Type",
        type: "select",
        description:
          "Light source kind. Point radiates in all directions; spot is a focused cone; directional is parallel; area is a soft filled region.",
        defaultValue: "point",
        options: ["point", "spot", "directional", "area"],
      },
      {
        key: "intensity",
        label: "Intensity",
        type: "slider",
        description: "Brightness multiplier. Higher values overdrive the light.",
        defaultValue: 1.5,
        min: 0,
        max: 10,
        step: 0.1,
      },
      {
        key: "color",
        label: "Color",
        type: "color",
        description: "Hex color of the light emission.",
        defaultValue: "#fbbf24",
      },
      {
        key: "falloff",
        label: "Falloff",
        type: "slider",
        description:
          "How quickly the light fades with distance — 0 is no falloff, 1 is steep.",
        defaultValue: 0.6,
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        key: "shadow",
        label: "Cast Shadow",
        type: "boolean",
        description: "Whether this light contributes to baked shadows.",
        defaultValue: true,
      },
    ],
  },
  sprite: {
    kind: "sprite",
    name: "Sprite",
    description:
      "2D billboard image rendered at the entity's position. Used for actors, pickups, and decor.",
    fields: [
      {
        key: "image",
        label: "Image",
        type: "string",
        description:
          "Asset path of the sprite image. References an entry from the project's image library.",
        defaultValue: "sprite.png",
      },
      {
        key: "scale",
        label: "Scale",
        type: "slider",
        description: "Uniform scale multiplier applied to the sprite's world size.",
        defaultValue: 1.0,
        min: 0.1,
        max: 5.0,
        step: 0.1,
      },
      {
        key: "fade",
        label: "Fade",
        type: "slider",
        description: "Opacity multiplier — 0 is fully transparent, 1 is fully opaque.",
        defaultValue: 1.0,
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        key: "billboard",
        label: "Billboard",
        type: "slider",
        description:
          "Camera-facing factor — 0 means the sprite stays in its world rotation, 1 fully tracks the camera.",
        defaultValue: 1.0,
        min: 0,
        max: 1,
        step: 0.01,
      },
    ],
  },
  movement: {
    kind: "movement",
    name: "Movement",
    description:
      "How this entity moves through the scene. Pick a behavior and tune its speed.",
    fields: [
      {
        key: "type",
        label: "Type",
        type: "select",
        description:
          "Movement behavior. Static does not move; patrol follows a fixed path; chase pursues the player; wander roams randomly.",
        defaultValue: "static",
        options: ["static", "patrol", "chase", "wander"],
      },
      {
        key: "speed",
        label: "Speed",
        type: "number",
        description: "World units per second when in motion.",
        defaultValue: 0,
        min: 0,
        max: 20,
        step: 0.1,
      },
    ],
  },
  position: {
    kind: "position",
    name: "Position",
    description:
      "World-space coordinates the entity instantiates at. Scene placement may override these.",
    fields: [
      {
        key: "x",
        label: "X",
        type: "number",
        description: "World X coordinate (east/west axis).",
        defaultValue: 0,
        step: 0.1,
      },
      {
        key: "y",
        label: "Y",
        type: "number",
        description: "World Y coordinate (vertical axis).",
        defaultValue: 0,
        step: 0.1,
      },
      {
        key: "z",
        label: "Z",
        type: "number",
        description: "World Z coordinate (north/south axis).",
        defaultValue: 0,
        step: 0.1,
      },
    ],
  },
  audio: {
    kind: "audio",
    name: "Audio",
    description:
      "Sound clip attached to the entity. Loops for ambient sources; one-shot for triggers and pickups.",
    fields: [
      {
        key: "clip",
        label: "Clip",
        type: "string",
        description:
          "Asset path of the audio clip. References an entry from the project's sound library.",
        defaultValue: "clip.ogg",
      },
      {
        key: "volume",
        label: "Volume",
        type: "slider",
        description: "Playback volume — 0 mutes, 1 is the clip's full level.",
        defaultValue: 1.0,
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        key: "loop",
        label: "Loop",
        type: "boolean",
        description: "Whether the clip loops indefinitely while the entity is alive.",
        defaultValue: false,
      },
    ],
  },
  collider: {
    kind: "collider",
    name: "Collider",
    description:
      "Physical shape used for collision and trigger volumes. Match the shape to the entity's silhouette.",
    fields: [
      {
        key: "shape",
        label: "Shape",
        type: "select",
        description:
          "Primitive used for the collider geometry. Box for blocky things, sphere for round, capsule for upright actors.",
        defaultValue: "box",
        options: ["box", "sphere", "capsule"],
      },
      {
        key: "radius",
        label: "Radius",
        type: "number",
        description:
          "Half-extent of the collider in world units. For boxes this is the half-width on each axis.",
        defaultValue: 0.5,
        min: 0,
        max: 5,
        step: 0.05,
      },
    ],
  },
} as const satisfies Record<ComponentKind, ComponentSchema>;
