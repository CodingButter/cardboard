/**
 * Pack component → TypeScript declaration emitter.
 *
 * Reads a pack's `manifest.components[]` entries (engine
 * `ComponentDef`) and produces a TypeScript source string that:
 *
 *  - Declares one `interface`/`type` per component, using the entry's
 *    `schema` to shape the field types (numbers / strings / booleans
 *    / nested objects / arrays). Components without a `schema` are
 *    NOT emitted as named types and resolve to `Component<unknown>`
 *    in the `PackComponents` augmentation below.
 *  - Augments `@two_5_d/engine`'s `PackComponents` interface with
 *    `Name: Component<Shape>` for every component that DID have a
 *    schema — that's what flows through `api.components.<Name>` at
 *    static-type time. Components without schemas are augmented as
 *    `Component<unknown>` so the name still has a concrete typing
 *    surface (just less specific).
 *
 * Pack-builder writes the result to `packages/<pack>/types/pack.d.ts`
 * at build time; future editor wiring (deferred) will feed the same
 * string into Monaco's `addExtraLib` so script editing has the same
 * component types the pack-builder uses.
 *
 * Schema subset supported (matches the JSON-Schema-ish shape declared
 * on `ComponentDef.schema`):
 *
 *   {
 *     "type": "object" | "number" | "string" | "boolean" | "array",
 *     "properties": { <name>: <schema>, … }   // for object
 *     "required":   [<name>, …]                 // for object
 *     "items":      <schema>                    // for array
 *   }
 *
 * Anything outside that shape resolves to `unknown`. A top-level
 * non-object schema (e.g. `{ "type": "number" }`) emits an alias
 * (`export type Facing = number;`) rather than an interface.
 *
 * Pure function — no I/O, no `process.*`. Lives in
 * `@two_5_d/shared` so both the pack-builder (`apps/pack-builder`)
 * and the editor (`apps/editor`, deferred) can import it.
 */

import type { ComponentDef } from "@two_5_d/engine";

/** Options bag for `generatePackTypes`. */
export interface GeneratePackTypesOpts {
  /** Shown in the file's header banner (typically `manifest.name`). */
  packName: string;
  /** Optional extra header lines appended to the banner comment. */
  headerExtra?: string;
}

/**
 * Generate a TypeScript declaration file for a pack's components.
 *
 * @param components  The `manifest.components[]` array.
 * @param opts        Header metadata.
 * @returns           TypeScript source string. Caller writes to disk
 *                    (pack-builder) or feeds it to Monaco
 *                    (`addExtraLib`, future editor wiring).
 */
export function generatePackTypes(
  components: ReadonlyArray<ComponentDef>,
  opts: GeneratePackTypesOpts,
): string {
  const { packName, headerExtra } = opts;

  // Deterministic ordering so byte-identical rebuilds are stable.
  // Manifest declaration order would also work; alphabetising avoids
  // surprising diffs when the manifest gets reshuffled.
  const ordered = [...components]
    .filter((c) => typeof c.name === "string" && c.name.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  const lines: string[] = [];
  lines.push(`// AUTO-GENERATED FROM ${packName} manifest.components — DO NOT EDIT.`);
  lines.push(`// Regenerate via \`bun run build-packs\` (or the editor's`);
  lines.push(`// component-save hook once wired).`);
  if (headerExtra) {
    for (const extra of headerExtra.split("\n")) {
      lines.push(`// ${extra}`);
    }
  }
  lines.push("");
  lines.push(`import type { Component } from "@two_5_d/engine";`);
  lines.push("");

  // Track each component's emitted "shape reference" — either a
  // named type/interface we just emitted, or a falls-back-to-unknown
  // marker for the augmentation block.
  const shapeRefs: Array<{ name: string; ref: string }> = [];

  for (const def of ordered) {
    const schema = def.schema;
    if (!schema || typeof schema !== "object") {
      // No schema → no named type, falls through to Component<unknown>.
      shapeRefs.push({ name: def.name, ref: "unknown" });
      continue;
    }
    const top = renderTopLevel(def.name, schema as JsonSchema);
    if (top.kind === "alias") {
      lines.push(`export type ${def.name} = ${top.source};`);
      lines.push("");
      shapeRefs.push({ name: def.name, ref: def.name });
    } else if (top.kind === "interface") {
      lines.push(`export interface ${def.name} ${top.source}`);
      lines.push("");
      shapeRefs.push({ name: def.name, ref: def.name });
    } else {
      // Top-level "unknown" — schema present but unsupported root type.
      shapeRefs.push({ name: def.name, ref: "unknown" });
    }
  }

  lines.push(`declare module "@two_5_d/engine" {`);
  lines.push(`  interface PackComponents {`);
  for (const { name, ref } of shapeRefs) {
    lines.push(`    ${name}: Component<${ref}>;`);
  }
  lines.push(`  }`);
  lines.push(`}`);
  lines.push("");

  return lines.join("\n");
}

/* ------------------------------------------------------------------------- */
/* Schema → TS source                                                         */
/* ------------------------------------------------------------------------- */

/** The opaque "JSON-Schema-ish" shape `ComponentDef.schema` uses. */
type JsonSchema = Record<string, unknown>;

interface TopRendered {
  /**
   * `interface` — emitted as `export interface Name { … }`.
   * `alias`     — emitted as `export type Name = X;`.
   * `inline`    — schema unrecognized; caller falls back to `unknown`
   *               in the augmentation.
   */
  kind: "interface" | "alias" | "inline";
  source: string;
}

function renderTopLevel(_name: string, schema: JsonSchema): TopRendered {
  const type = readType(schema);
  if (type === "object") {
    return { kind: "interface", source: renderObjectBody(schema) };
  }
  if (type === "number" || type === "string" || type === "boolean") {
    return { kind: "alias", source: type };
  }
  if (type === "array") {
    return { kind: "alias", source: renderArray(schema) };
  }
  return { kind: "inline", source: "unknown" };
}

/** Render the TS for a single schema value (recurses on object/array). */
function renderSchema(schema: unknown): string {
  if (!schema || typeof schema !== "object") return "unknown";
  const s = schema as JsonSchema;
  const type = readType(s);
  if (type === "number") return "number";
  if (type === "string") return "string";
  if (type === "boolean") return "boolean";
  if (type === "array") return renderArray(s);
  if (type === "object") return renderObjectBody(s);
  return "unknown";
}

function renderArray(schema: JsonSchema): string {
  const items = (schema as { items?: unknown }).items;
  const inner = renderSchema(items);
  // Wrap in parens if the inner contains a `|` (union) so the `[]`
  // suffix doesn't bind too tight. Current subset never produces a
  // union, but the guard is cheap insurance for future expansion.
  return inner.includes("|") ? `(${inner})[]` : `${inner}[]`;
}

function renderObjectBody(schema: JsonSchema): string {
  const props = (schema as { properties?: Record<string, unknown> }).properties;
  if (!props || typeof props !== "object") {
    // `{ type: "object" }` with no `properties` → opaque object.
    return "Record<string, unknown>";
  }
  const required = readRequired(schema);
  const keys = Object.keys(props).sort();
  if (keys.length === 0) return "Record<string, unknown>";

  const parts: string[] = ["{"];
  for (const key of keys) {
    const sub = props[key];
    const optional = required.has(key) ? "" : "?";
    const safeKey = isSafeIdentifier(key) ? key : JSON.stringify(key);
    parts.push(`  ${safeKey}${optional}: ${renderSchema(sub)};`);
  }
  parts.push("}");
  return parts.join("\n");
}

function readType(schema: JsonSchema): string | undefined {
  const t = (schema as { type?: unknown }).type;
  return typeof t === "string" ? t : undefined;
}

function readRequired(schema: JsonSchema): Set<string> {
  const r = (schema as { required?: unknown }).required;
  if (Array.isArray(r)) {
    return new Set(r.filter((x): x is string => typeof x === "string"));
  }
  return new Set();
}

const SAFE_IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
function isSafeIdentifier(key: string): boolean {
  return SAFE_IDENT.test(key);
}
