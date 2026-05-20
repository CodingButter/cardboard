/**
 * Slimmed scene fixtures — pack-local subset used by the panels this
 * pack has so far migrated out of `apps/editor/src/views/`.
 *
 * Today only LightingPanel reads from this file, so only the light
 * fixtures live here. Subsequent P3 batches will fold in additional
 * MOCK_* exports (layers, presets, prefabs, etc.) as the panels that
 * consume them migrate in. The full source-of-truth at
 * `apps/editor/src/views/scene/scene-fixtures.ts` ALSO remains in the
 * shell tree while batches B–D are still pulling from it; once the
 * migration is complete the editor copy is deleted (CORE_EDITOR_PACK.md
 * §3.1).
 *
 * Keeping the file pack-local rather than reaching back into the
 * editor's source preserves the "no editor-source value imports"
 * invariant the dogfooding principle enforces. The shell SDK does not
 * expose fixture data — fixtures are pack content, not platform
 * surface area.
 */

// ---------------------------------------------------------------------------
// Lights — consumed by LightingPanel.

export type LightKind = "point" | "spot" | "directional" | "area";

export interface LightRow {
  id: string;
  name: string;
  kind: LightKind;
  position: { x: number; y: number; z: number };
  /** 6-digit `#RRGGBB` hex color of the light. */
  color: string;
  /** 0..10 brightness multiplier. */
  intensity: number;
  enabled: boolean;
  description: string;
}

export const MOCK_LIGHTS = [
  { id: "light-sun", name: "Sun", kind: "directional", position: { x: 0, y: 50, z: 0 }, color: "#fef9c3", intensity: 1.0, enabled: true, description: "Primary scene sunlight. Cast direction from above." },
  { id: "light-torch-1", name: "Torch 1", kind: "point", position: { x: 12, y: 2, z: 7 }, color: "#fb923c", intensity: 2.5, enabled: true, description: "Wall torch near the entrance. Flickers." },
  { id: "light-torch-2", name: "Torch 2", kind: "point", position: { x: 24, y: 2, z: 7 }, color: "#fb923c", intensity: 2.5, enabled: true, description: "Wall torch in the corridor." },
  { id: "light-spotlight-boss", name: "Boss Spotlight", kind: "spot", position: { x: 40, y: 6, z: 40 }, color: "#a78bfa", intensity: 4.0, enabled: false, description: "Dramatic spot on the boss arena. Triggers on encounter." },
  { id: "light-ambient-pit", name: "Pit Ambient", kind: "area", position: { x: 20, y: 0, z: 20 }, color: "#22d3ee", intensity: 1.2, enabled: true, description: "Cool fill light in the pit chamber." },
] as const satisfies readonly LightRow[];
