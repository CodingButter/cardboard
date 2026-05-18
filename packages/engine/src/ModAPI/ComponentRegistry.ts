import { Component } from "ECS";
import {
  Position,
  Facing,
  Aim,
  Camera,
  Sprite,
  Animation,
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
 *
 * **Engine built-ins are the slim set the renderer / scene-loader
 * touches directly**: `Position`, `Facing`, `Aim`, `Camera`, `Sprite`,
 * `Animation`, `Light`, `Shader`. Everything else (player input,
 * weapons, inventory, gameplay tags) is pack-declared per
 * `docs/plans/PREFABS_EDITOR_ONLY.md` §17 — the registry instantiates
 * those as opaque `Component<unknown>` at boot from
 * `manifest.components[]`.
 */
export class ComponentRegistry {
  /**
   * Engine-shipped components — the storage instances the renderer +
   * scene loader read directly. Keep this list tight: every entry is
   * a coupling between engine code and a specific component shape.
   */
  private readonly engineBuiltIns: Record<string, Component<unknown>> = {
    Position: Position as unknown as Component<unknown>,
    Facing: Facing as unknown as Component<unknown>,
    Aim: Aim as unknown as Component<unknown>,
    Camera: Camera as unknown as Component<unknown>,
    Sprite: Sprite as unknown as Component<unknown>,
    Animation: Animation as unknown as Component<unknown>,
    Light: Light as unknown as Component<unknown>,
    Shader: Shader as unknown as Component<unknown>,
  };

  private readonly customComponents = new Map<string, Component<unknown>>();
  private readonly metadata = new Map<string, ComponentMetadata>();

  /**
   * Lookup proxy exposed on `api.components`. Reads dispatch through
   * `getComponent` so manifest-declared / script-defined components
   * resolve under their string name (`api.components.PlayerInput`)
   * regardless of whether they're an engine built-in or a pack add.
   *
   * Typed as `BuiltInComponents` so static-typed pack code that reads
   * `api.components.Position` still gets the precise `Component<Vec2>`
   * shape for engine built-ins; everything else falls through to the
   * proxy at runtime.
   */
  readonly builtIns: BuiltInComponents;

  constructor() {
    // Seed metadata for engine built-ins.
    for (const name of Object.keys(this.engineBuiltIns)) {
      this.metadata.set(name, { name, source: "engine" });
    }
    const registry = this;
    this.builtIns = new Proxy({} as unknown as BuiltInComponents, {
      get(_target, prop): unknown {
        if (typeof prop !== "string") return undefined;
        return registry.getComponent(prop);
      },
      has(_target, prop): boolean {
        if (typeof prop !== "string") return false;
        return registry.getComponent(prop) !== undefined;
      },
      ownKeys(): string[] {
        return registry.allNames();
      },
      getOwnPropertyDescriptor(_target, prop): PropertyDescriptor | undefined {
        if (typeof prop !== "string") return undefined;
        const c = registry.getComponent(prop);
        if (c === undefined) return undefined;
        return {
          enumerable: true,
          configurable: true,
          writable: false,
          value: c,
        };
      },
    });
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
    return this.customComponents.get(name) ?? this.engineBuiltIns[name];
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
      const builtIn = this.engineBuiltIns[name];
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
    const names = new Set<string>(Object.keys(this.engineBuiltIns));
    for (const name of this.customComponents.keys()) names.add(name);
    return [...names].sort();
  }

  /** Snapshot every registered Component instance (for serialize). */
  allComponents(): Component<unknown>[] {
    const out: Component<unknown>[] = [];
    for (const name of Object.keys(this.engineBuiltIns)) {
      out.push(this.engineBuiltIns[name]!);
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
