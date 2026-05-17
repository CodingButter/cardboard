/**
 * Engine-side debug / telemetry surface.
 *
 * Q5 of `docs/plans/EDITOR_REDESIGN.md` §12 — single source of truth
 * for the in-game dev console (CONSOLE.md `stats`/`gpu`/`entities`)
 * and the editor's Playtest stats panel (EDITOR_IFRAME I2 telemetry
 * channel). See `stats.ts` for the collector + EngineStats shape.
 */
export { StatsCollector } from "./stats";
export type {
  EngineStats,
  StatsWorldView,
  StatsSceneView,
  StatsAudioView,
  StatsRendererView,
} from "./stats";
