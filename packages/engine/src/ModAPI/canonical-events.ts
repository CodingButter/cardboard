import type { Entity } from "ECS";
import type { Vec2 } from "Libs/Vector";
import type { KeyCode } from "Controllers/KeyboardController";
import type { PackManifest } from "AssetPack";

/**
 * Canonical engine-emitted events — Ev1 of `docs/plans/EVENTS.md` §4.
 *
 * Engine emits these at well-known lifecycle moments; pack scripts
 * subscribe by name via `api.events.on("scene:loaded", …)`. The list
 * grows additively — once a topic ships, its name + payload shape
 * stay stable. Pack-emitted custom events (§5) are NOT in this map;
 * pack authors own their own contracts.
 *
 * This file is reference-only — engines emit string-typed topics and
 * the `EventsAPI.on` generic accepts a per-call payload type. Callers
 * wanting compile-time safety can do:
 *
 *   import type { CanonicalEvents } from "@two_5_d/engine";
 *   api.events.on<CanonicalEvents["scene:loaded"]>("scene:loaded", p => …);
 *
 * (A future helper could enforce keyof CanonicalEvents on the topic
 * string; intentionally left flexible for Ev1 so pack-custom topics
 * stay first-class.)
 *
 * Total: 25 canonical events. See §4.9 of EVENTS.md for the full list.
 */
export interface CanonicalEvents {
  // --- World lifecycle (WORLD_STATE.md §6.1) ------------------------
  /**
   * Fires ONCE per `Game` lifetime, AFTER `runPackScripts()` and
   * BEFORE the first scene-controller spawns. Pack scripts use it
   * for one-time setup that doesn't depend on a live scene
   * controller or its components.
   */
  "world:ready": Record<string, never>;

  // --- Scene lifecycle (§4.1) ---------------------------------------
  /** Fires before a scene swap begins; new scene parsed, no entities spawned for it yet. */
  "scene:beforeLoad": { from?: string; to: string };
  /** Fires after `spawnInitialEntities()` + every `onWorldReady` callback. Safe to query entities. */
  "scene:loaded": { name: string; size: { x: number; y: number } };
  /** Fires before the active scene's world is torn down. Last chance to read entity state. */
  "scene:beforeUnload": { name: string };
  /**
   * Alias for `scene:beforeUnload` per WORLD_STATE.md §6.2 — same
   * payload, same fire moment. Both names fire so subscribers using
   * the new vocabulary and legacy subscribers both see the event.
   * The duplicate name is intentional during the one-release
   * back-compat window.
   */
  "scene:willUnload": { name: string };

  // --- Entity lifecycle (§4.2) --------------------------------------
  /** Fires from `ModAPIImpl.spawnPrefab` after the factory returns. Prefab spawns only. */
  "entity:spawned": { entity: Entity; prefabName?: string };
  /** Fires SYNCHRONOUSLY BEFORE `world.despawn` removes the entity, so handlers can read components. */
  "entity:despawned": { entity: Entity };

  // --- Player state (§4.3) ------------------------------------------
  /** Throttled: every Nth frame OR cell-boundary cross (whichever first). Default N=10. */
  "player:moved": {
    position: Vec2;
    velocity: Vec2;
    cellX: number;
    cellY: number;
  };
  /** Player's `Health` drops ≤ 0. Reserved until a Health component lands (Ev2 wiring). */
  "player:died": { entity: Entity; killer?: Entity };
  /** Position set non-incrementally (scene transitions, debug warps). */
  "player:teleported": { from: Vec2; to: Vec2 };

  // --- Modal lifecycle (§4.4) ---------------------------------------
  /** `ModalRegistry.setOpen(name, true)` transitions OFF→ON. */
  "modal:opened": { name: string };
  /** `ModalRegistry.setOpen(name, false)` transitions ON→OFF. */
  "modal:closed": { name: string };

  // --- Input (§4.5) -------------------------------------------------
  "input:keyDown": {
    key: KeyCode;
    modifiers: { shift: boolean; ctrl: boolean; alt: boolean; meta: boolean };
  };
  "input:keyUp": {
    key: KeyCode;
    modifiers: { shift: boolean; ctrl: boolean; alt: boolean; meta: boolean };
  };
  "input:mouseDown": {
    button: number;
    position: Vec2;
    modifiers: { shift: boolean; ctrl: boolean; alt: boolean; meta: boolean };
  };
  "input:mouseUp": {
    button: number;
    position: Vec2;
    modifiers: { shift: boolean; ctrl: boolean; alt: boolean; meta: boolean };
  };
  "input:wheel": {
    deltaY: number;
    modifiers: { shift: boolean; ctrl: boolean; alt: boolean; meta: boolean };
  };

  // --- Pack lifecycle (§4.6) ----------------------------------------
  /** Once at boot, after every pack script + every `onWorldReady` callback. */
  "pack:loaded": { manifest: PackManifest };
  /** After an HMR pack reload. World already has entities. */
  "pack:reloaded": { manifest: PackManifest; reason: "hmr" | "manual" };

  // --- Frame ticks (§4.7) — fire 60+ Hz. The registry's no-subscriber
  // fast path keeps idle cost ~5 ns. ----------------------------------
  /** Top of `Game.update`, before any system runs. */
  "frame:before": { deltaTime: number; frameIndex: number };
  /** Bottom of `Game.update`, after every system + UI flush. */
  "frame:after": { deltaTime: number; frameIndex: number };

  // --- Inventory + pickup (§4.8) — default-pack emitted, canonical names ---
  "inventory:added": {
    entity: Entity;
    itemId: string;
    count: number;
    slot?: string;
  };
  "inventory:removed": { entity: Entity; itemId: string; count: number };
  "inventory:activeChanged": { entity: Entity; from: number; to: number };
  "pickup:collected": { player: Entity; itemId: string; count: number };
  "weapon:fired": { player: Entity; weaponId: string; ammoLeft: number };
}

/**
 * Throttle constant for `player:moved` — emit at most every Nth frame
 * (a position-tracker also fires on cell-boundary cross). See §4.3.
 */
export const PLAYER_MOVED_FRAME_THROTTLE = 10;
