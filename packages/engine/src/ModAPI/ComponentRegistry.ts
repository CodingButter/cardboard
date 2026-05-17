import { Component } from "ECS";
import {
  Position,
  Facing,
  Movement,
  PlayerInput,
  Aim,
  Camera,
  MinimapMarker,
  Weapon,
  Inventory,
  Sprite,
  Animation,
  Pickup,
  Light,
  Shader,
} from "Components";
import type { ComponentDef } from "AssetPack";
import type { BuiltInComponents } from "./types";

/**
 * Editor-/serialize-side metadata for a registered component. Mirrors
 * the `manifest.components[]` entry shape (WORLD_STATE.md §4) plus a
 * `source` tag so the editor can distinguish "engine built-in" /
 * "manifest-declared" / "script-defined" components without re-reading
 * the manifest.
 *
 * Engine never reads `tags` or `schema`; both round-trip as opaque
 * metadata available to editor tooling (Q1 of WORLD_STATE §12 —
 * tags-free-form) and the future strict-mode validator
 * (O5 of WORLD_STATE §12).
 */
export interface ComponentMetadata {
  /** Canonical name — same key the registry looks up by. */
  readonly name: string;
  /**
   * `"engine"` for built-ins, `"manifest"` for manifest-declared
   * entries, `"script"` for `api.defineComponent()` calls.
   */
  readonly source: "engine" | "manifest" | "script";
  /** Optional editor-only tag list (free-form). */
  readonly tags?: ReadonlyArray<string>;
  /** Optional JSON-schema-ish object. Engine treats as opaque. */
  readonly schema?: Record<string, unknown>;
}

/**
 * Tracks every component the runtime knows about: engine built-ins,
 * pack-manifest declarations (WORLD_STATE.md §4), and components
 * created by pack scripts via `api.defineComponent`. `getComponent`
 * resolves names across all three sources.
 */
export class ComponentRegistry {
  readonly builtIns: BuiltInComponents = {
    Position,
    Facing,
    Movement,
    PlayerInput,
    Aim,
    Camera,
    MinimapMarker,
    Weapon,
    Inventory,
    Sprite,
    Animation,
    Pickup,
    Light,
    Shader,
  };

  private readonly customComponents = new Map<string, Component<unknown>>();
  private readonly metadata = new Map<string, ComponentMetadata>();

  constructor() {
    // Seed metadata for built-ins — editor pickers + serialize use it.
    for (const name of Object.keys(this.builtIns) as Array<keyof BuiltInComponents>) {
      this.metadata.set(name, { name, source: "engine" });
    }
  }

  /**
   * Create a new component, registered by name so other scripts (and
   * `getComponent`) can find it. Throws if `name` is already taken.
   */
  defineComponent<T>(name: string): Component<T> {
    if (this.getComponent(name)) {
      throw new Error(`Component "${name}" is already defined`);
    }
    const c = new Component<T>(name);
    this.customComponents.set(name, c as Component<unknown>);
    this.metadata.set(name, { name, source: "script" });
    return c;
  }

  /** Look up a previously defined component (built-in or mod). */
  getComponent(name: string): Component<unknown> | undefined {
    return (
      this.customComponents.get(name) ??
      (this.builtIns as unknown as Record<string, Component<unknown>>)[name]
    );
  }

  /**
   * Register every entry in `manifest.components[]` (WORLD_STATE.md
   * §4 + §10.3). Built-in conflicts are tolerated — the built-in
   * keeps the live `Component<unknown>` instance; the manifest entry
   * augments its metadata (tags + schema) so editor pickers can
   * still filter them. Pack-chain order is deps-first → root-last
   * (caller drives the iteration); later packs override earlier
   * packs' metadata for the same name with a warning.
   *
   * Returns `{ created, augmented, conflicted }` counts so the
   * caller can log a summary.
   */
  registerFromManifest(
    defs: ReadonlyArray<ComponentDef> | undefined,
    packLabel: string,
  ): { created: number; augmented: number; conflicted: number } {
    let created = 0;
    let augmented = 0;
    let conflicted = 0;
    if (!defs) return { created, augmented, conflicted };
    for (const def of defs) {
      const { name, schema, tags } = def;
      if (typeof name !== "string" || name.length === 0) {
        console.warn(`[components] ${packLabel}: skipping entry without a name`);
        continue;
      }
      const builtIn = (this.builtIns as unknown as Record<string, Component<unknown>>)[name];
      const existing = this.metadata.get(name);
      if (builtIn !== undefined) {
        // Built-in: keep the live Component; record the
        // manifest-declared metadata for editor consumers.
        this.metadata.set(name, {
          name,
          source: existing?.source ?? "engine",
          tags: tags ?? existing?.tags,
          schema: schema ?? existing?.schema,
        });
        augmented += 1;
        continue;
      }
      if (this.customComponents.has(name)) {
        // Already registered by a prior pack — last-pack-wins on
        // metadata. Warn on schema divergence (shape comparison is
        // a structural deep-equal; cheap for the small shapes packs
        // ship).
        if (existing && !sameSchema(existing.schema, schema)) {
          console.warn(
            `[components] ${packLabel}: "${name}" schema redefined; ` +
              "later pack wins (WORLD_STATE.md §10.3).",
          );
          conflicted += 1;
        }
        this.metadata.set(name, {
          name,
          source: existing?.source ?? "manifest",
          tags: tags ?? existing?.tags,
          schema: schema ?? existing?.schema,
        });
        augmented += 1;
        continue;
      }
      // New component for this chain — instantiate + register.
      const c = new Component<unknown>(name);
      this.customComponents.set(name, c);
      this.metadata.set(name, { name, source: "manifest", tags, schema });
      created += 1;
    }
    return { created, augmented, conflicted };
  }

  /** Read-side accessor for editor / serialize tooling. */
  getMetadata(name: string): ComponentMetadata | undefined {
    return this.metadata.get(name);
  }

  /** Snapshot every registered component name (sorted, dedup-free). */
  allNames(): string[] {
    const names = new Set<string>(Object.keys(this.builtIns));
    for (const name of this.customComponents.keys()) names.add(name);
    return [...names].sort();
  }

  /** Snapshot every registered Component instance (for serialize). */
  allComponents(): Component<unknown>[] {
    const out: Component<unknown>[] = [];
    for (const name of Object.keys(this.builtIns)) {
      out.push((this.builtIns as unknown as Record<string, Component<unknown>>)[name]!);
    }
    for (const c of this.customComponents.values()) out.push(c);
    return out;
  }
}

/**
 * Structural deep-equal for JSON-shaped schemas. Order-insensitive
 * for object keys, order-sensitive for arrays. Returns `true` when
 * both are `undefined` so the "no schema declared on either side"
 * common case skips the warning.
 */
function sameSchema(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined,
): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  return deepEqual(a, b);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (typeof a === "object") {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao);
    const bk = Object.keys(bo);
    if (ak.length !== bk.length) return false;
    for (const k of ak) if (!deepEqual(ao[k], bo[k])) return false;
    return true;
  }
  return false;
}
