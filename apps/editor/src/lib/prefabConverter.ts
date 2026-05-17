/**
 * JS → declarative prefab converter (Phase #196 part B).
 *
 * Best-effort static analyser that walks a JS pack-script and extracts
 * the statically-resolvable `world.add(entity, C.X, value)` calls out
 * of the prefab's factory body. Each extractable call becomes an
 * entry in `manifest.prefabs[name].components`; everything else
 * (dynamic opts overlays, control flow, multi-entity spawns) is left
 * in a residual `initScript` so the prefab keeps working unchanged.
 *
 * DOM-free, lazy-loaded — the editor's main bundle doesn't see Babel.
 * Imports of `@babel/parser` go through a one-off async loader so the
 * code-split lands the parser only when the user clicks "Convert".
 *
 * Public surface:
 *
 *   `parsePrefabFromSource(src)` — pure parse + classify, returns a
 *     structured `PrefabConversionResult` with the static map, the
 *     residual lines, comments preserved, and per-call annotations.
 *
 *   `serializeInitScript(result)` — re-emit a runnable JS module body
 *     for the residual logic that the engine's pack-script loader
 *     can `import()` and call as `(entity, opts, api) => void`.
 *
 *   `prefabPathForName(name, kind)` — naming convention for the new
 *     `scripts/prefabs/<name>-init.js`.
 *
 * The converter is intentionally conservative:
 *
 *   - Only `world.add(entity, C.X, <expr>)` / `api.world.add(e, api.components.X, <expr>)`
 *     calls inside the factory are even considered.
 *   - The 3rd argument must reduce statically to a literal (number,
 *     string, boolean, null, array literal of literals, object
 *     literal of literals) or a `new api.Vec2(x, y)` / `new Vec2(x, y)`
 *     call with literal args (Position shorthand). Anything that
 *     references `opts.*` or any non-literal binding stays in the
 *     residual.
 *   - Chained `.add(...).add(...)` is normalised back into the
 *     statement list before classification.
 *   - When zero calls are extractable, the result flags
 *     `tooDynamic: true` so the UI can offer "keep as JS" instead.
 *
 * See `apps/editor/scripts/smoke-prefab-converter.ts` for the
 * end-to-end matrix this module is regression-tested against.
 */

import type {
  ArrayExpression,
  ArrowFunctionExpression,
  CallExpression,
  Comment,
  Expression,
  FunctionExpression,
  Node,
  ObjectExpression,
  Statement,
} from "@babel/types";

/**
 * One classified `world.add(entity, C.X, value)` call.
 *
 * For extractable calls, `staticValue` holds the JSON-shaped data the
 * declarative path consumes. For non-extractable calls,
 * `residualSource` holds the original source text (whitespace + comment
 * preservation) that the init-script emitter splices back into the
 * generated module.
 */
export interface PrefabComponentCall {
  /** The component name as referenced in the call (`C.X` → `"X"`). */
  componentName: string;
  /**
   * `true` when the value reduced to a static JSON shape. The
   * `staticValue` field is populated when this is `true`.
   */
  extractable: boolean;
  /** Reason a call wasn't extracted, surfaced in the UI diff. */
  reason?: string;
  /** JSON-shaped data for the declarative `components` map. */
  staticValue?: unknown;
  /** Verbatim source snippet for the residual initScript. */
  residualSource: string;
  /** Comments attached to this call's source span. */
  leadingComment?: string;
}

export interface PrefabConversionResult {
  /** Prefab id from the `registerPrefab("name", ...)` call. */
  name: string;
  /** Classified calls in source order. */
  calls: PrefabComponentCall[];
  /**
   * `componentName → staticValue` for every extractable call.
   * Iteration order matches first appearance in the factory body.
   */
  staticComponents: Record<string, unknown>;
  /**
   * Residual JS that must run at spawn time. The emitter wraps this
   * into a default-export function with signature
   * `(entity, opts, api) => void`. Empty when every call extracted.
   */
  residualBody: string;
  /** Top-of-file comments preserved into the residual module. */
  leadingComments: string;
  /**
   * `true` when zero component calls extracted statically — the UI
   * should surface "this prefab is too dynamic, keep as JS" instead
   * of forcing an empty-shell conversion.
   */
  tooDynamic: boolean;
  /** Total `world.add` calls discovered (extracted + non-extracted). */
  totalCalls: number;
  /** Calls that extracted to the static map. */
  extractedCount: number;
}

/**
 * One conversion job for an entire script file. A single file can
 * register multiple prefabs; we emit one `PrefabConversionResult` per
 * registration so the UI can offer per-prefab apply/skip.
 */
export interface PrefabFileConversion {
  /** Original script path (`scripts/prefabs/player.js`). */
  sourcePath: string;
  /** One result per `api.registerPrefab(...)` call. */
  prefabs: PrefabConversionResult[];
  /**
   * `true` when no `registerPrefab` call was found at all — the file
   * isn't a prefab script and the converter has nothing to say.
   */
  noPrefabsFound: boolean;
  /** Parser error if Babel couldn't parse the source. */
  parseError?: string;
}

/* -------------------------------------------------------------------- */
/*  Lazy Babel loader                                                   */
/* -------------------------------------------------------------------- */

let babelParserPromise: Promise<typeof import("@babel/parser")> | null = null;

/**
 * Code-split the parser. The editor's main bundle doesn't need
 * `@babel/parser` until the user clicks "Convert to declarative" —
 * dynamic import lands it as its own chunk. Cached after first call.
 */
export async function loadBabelParser(): Promise<
  typeof import("@babel/parser")
> {
  if (!babelParserPromise) {
    babelParserPromise = import("@babel/parser");
  }
  return babelParserPromise;
}

/* -------------------------------------------------------------------- */
/*  Public entry — parse + classify                                     */
/* -------------------------------------------------------------------- */

/**
 * Walk `source` and produce one `PrefabConversionResult` per
 * `api.registerPrefab(...)` call found at the top level.
 */
export async function parsePrefabFile(
  sourcePath: string,
  source: string,
): Promise<PrefabFileConversion> {
  const parser = await loadBabelParser();
  let ast;
  try {
    ast = parser.parse(source, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
      attachComment: true,
      tokens: false,
      errorRecovery: false,
    });
  } catch (err) {
    return {
      sourcePath,
      prefabs: [],
      noPrefabsFound: false,
      parseError: (err as Error).message,
    };
  }

  const registrations = collectRegistrations(ast.program.body);
  if (registrations.length === 0) {
    return { sourcePath, prefabs: [], noPrefabsFound: true };
  }

  const fileComments = ast.comments ?? [];
  const leadingComments = extractFileLeadingComments(fileComments, source);

  const prefabs: PrefabConversionResult[] = [];
  for (const reg of registrations) {
    prefabs.push(classifyRegistration(reg, source, leadingComments));
  }
  return { sourcePath, prefabs, noPrefabsFound: false };
}

/* -------------------------------------------------------------------- */
/*  Registration discovery                                              */
/* -------------------------------------------------------------------- */

interface RegistrationFound {
  /** `"name"` literal from `registerPrefab("name", factory)`. */
  name: string;
  /** The factory function expression (arrow or regular). */
  factory: ArrowFunctionExpression | FunctionExpression;
  /** The `registerPrefab(...)` call node — for span info. */
  callNode: CallExpression;
  /**
   * Sibling statements from the surrounding `export default (api) => { ... }`
   * body that ran BEFORE this `registerPrefab` call. These hold the
   * closure-captured bindings (e.g. `const defaultCamera = () => ({...})`
   * in default-pack's `player.js`) that the factory body references.
   * Hoisted into the residual init script when needed.
   */
  closureSiblings: Statement[];
}

/**
 * Walk every statement in `body` and return each
 * `api.registerPrefab("name", factory)` we can confidently identify.
 *
 * Accepted shapes:
 *  - `api.registerPrefab("name", (opts) => { ... })`
 *  - `api.registerPrefab('name', function (opts) { ... })`
 *  - The same calls hidden inside `export default (api) => { ... }`
 *    or `export default function (api) { ... }` (the canonical
 *    default-pack pattern). We descend one level into the export.
 */
function collectRegistrations(
  body: Statement[],
): RegistrationFound[] {
  const out: RegistrationFound[] = [];
  for (const stmt of body) {
    collectFromStatement(stmt, out);
  }
  return out;
}

function collectFromStatement(
  stmt: Statement,
  out: RegistrationFound[],
  siblings: Statement[] = [],
): void {
  switch (stmt.type) {
    case "ExpressionStatement":
      collectFromExpression(stmt.expression, out, siblings);
      return;
    case "ExportDefaultDeclaration": {
      const decl = stmt.declaration;
      if (
        decl.type === "ArrowFunctionExpression" ||
        decl.type === "FunctionExpression" ||
        decl.type === "FunctionDeclaration"
      ) {
        // Descend into the function body. Each child statement that
        // PRECEDES a `registerPrefab(...)` is a sibling — its bindings
        // may close over the factory body and need hoisting into the
        // residual init script. We accumulate the prefix list as we
        // walk so each registration sees only the siblings declared
        // ahead of it (later siblings can't be referenced by an
        // earlier factory anyway in the canonical default-export
        // shape, but we keep order to be safe).
        const body = decl.body;
        if (body.type === "BlockStatement") {
          const prefix: Statement[] = [];
          for (const inner of body.body) {
            collectFromStatement(inner, out, prefix);
            // After processing, this inner statement becomes part of
            // the closure prefix available to subsequent siblings.
            prefix.push(inner);
          }
        } else {
          // Implicit-return arrow body — `(api) => api.registerPrefab(...)`.
          collectFromExpression(body, out, siblings);
        }
      }
      return;
    }
    case "VariableDeclaration": {
      for (const d of stmt.declarations) {
        if (d.init) collectFromExpression(d.init, out, siblings);
      }
      return;
    }
    case "BlockStatement": {
      for (const inner of stmt.body) collectFromStatement(inner, out, siblings);
      return;
    }
    default:
      return;
  }
}

function collectFromExpression(
  expr: Expression,
  out: RegistrationFound[],
  siblings: Statement[] = [],
): void {
  if (expr.type === "CallExpression") {
    const reg = matchRegisterPrefabCall(expr);
    if (reg) {
      reg.closureSiblings = siblings.slice();
      out.push(reg);
    }
  }
}

/**
 * Recognise `api.registerPrefab("name", factory)` (or the bare
 * `registerPrefab(...)` form). Returns null if the call doesn't
 * match the shape.
 */
function matchRegisterPrefabCall(
  call: CallExpression,
): RegistrationFound | null {
  const callee = call.callee;
  const matchesName =
    (callee.type === "MemberExpression" &&
      !callee.computed &&
      callee.property.type === "Identifier" &&
      callee.property.name === "registerPrefab") ||
    (callee.type === "Identifier" && callee.name === "registerPrefab");
  if (!matchesName) return null;
  if (call.arguments.length < 2) return null;

  const nameArg = call.arguments[0];
  if (!nameArg || nameArg.type !== "StringLiteral") return null;

  const factoryArg = call.arguments[1];
  if (
    !factoryArg ||
    (factoryArg.type !== "ArrowFunctionExpression" &&
      factoryArg.type !== "FunctionExpression")
  ) {
    return null;
  }

  return {
    name: nameArg.value,
    factory: factoryArg,
    callNode: call,
    closureSiblings: [],
  };
}

/* -------------------------------------------------------------------- */
/*  Per-registration classification                                     */
/* -------------------------------------------------------------------- */

interface AddCallInfo {
  componentName: string;
  /** The chain element node whose 3rd arg is the value. */
  valueExpr: Node;
  /**
   * Original source text for the entire statement holding the chain.
   * Kept for diagnostics; the residual emitter prefers the per-link
   * `valueSource` so a 9-link chain with only 1 extractable call
   * doesn't get 8 copies of the entire statement in the residual.
   */
  statementSource: string;
  /**
   * Original source text of just the 3rd argument (the value
   * expression) for this individual chain link. The residual emitter
   * uses this to synthesise a clean per-link `world.add(...)` line
   * for each non-extractable call.
   */
  valueSource: string;
  /** Leading comment (single block joined) attached to the statement. */
  leadingComment?: string;
}

function classifyRegistration(
  reg: RegistrationFound,
  source: string,
  fileLeadingComments: string,
): PrefabConversionResult {
  const body = reg.factory.body;
  if (body.type !== "BlockStatement") {
    // `(opts) => api.world.add(...)` — single-expression arrow body.
    // Treat it as a one-statement block by classifying the expression
    // directly.
    const singleCall = matchAddCall(body, source);
    const staticComponents: Record<string, unknown> = {};
    const calls: PrefabComponentCall[] = [];
    if (singleCall) {
      const classified = classifyOneAdd(singleCall, body);
      if (classified.extractable && classified.staticValue !== undefined) {
        staticComponents[classified.componentName] = classified.staticValue;
      }
      calls.push(classified);
    }
    const residualBody = singleCall && !calls[0]!.extractable
      ? singleCall.statementSource
      : "";
    return {
      name: reg.name,
      calls,
      staticComponents,
      residualBody,
      leadingComments: fileLeadingComments,
      tooDynamic: calls.length === 0 || calls.every((c) => !c.extractable),
      totalCalls: calls.length,
      extractedCount: Object.keys(staticComponents).length,
    };
  }

  // Walk the block. Each statement is either:
  //   - a chained `world.add(e, C.X, val).add(...).add(...)` — flatten
  //     each chain element into its own logical AddCallInfo;
  //   - some other expression / control flow / declaration — kept
  //     wholesale in the residual.
  const flatAdds: AddCallInfo[] = [];
  const residualStatements: string[] = [];
  // Closure-binding source text from the surrounding `export default
  // (api) => { ... }` body (e.g. top-level `const defaultCamera = …`
  // in default-pack's player.js). Hoisted into the residual init
  // script when the factory body references the binding identifier.
  const closureHoists: string[] = [];
  // Closure-binding source text from the surrounding `export default
  // (api) => { ... }` body (e.g. top-level `const defaultCamera = …`
  // in default-pack's player.js). Hoisted into the residual init
  // script when the factory body references the binding identifier.
  const closureHoists: string[] = [];

  for (const stmt of body.body) {
    if (stmt.type === "ReturnStatement") {
      // Drop `return entity;` — the engine spawns + returns the entity.
      // If the return expression isn't a bare identifier, keep it in
      // residual so multi-entity factories survive.
      const expr = stmt.argument;
      if (!expr || expr.type === "Identifier") {
        continue;
      }
      residualStatements.push(stmtSource(stmt, source));
      continue;
    }
    if (stmt.type === "ExpressionStatement") {
      const flattened = flattenAddChain(stmt.expression, stmt, source);
      if (flattened) {
        flatAdds.push(...flattened);
        continue;
      }
    }
    if (stmt.type === "VariableDeclaration") {
      // Drop the trivial `const entity = world.spawn()` and friends
      // since the engine already spawns the entity in the declarative
      // factory. Everything else (inventory setup, helper vars) keeps.
      const allTrivial = stmt.declarations.every((d) =>
        isWorldSpawnInit(d.init),
      );
      if (allTrivial) continue;
      // Drop `const world = api.world;` / `const C = api.components;`
      // — the init-script wrapper re-declares these aliases, so leaving
      // them in the residual produces a `SyntaxError: Identifier
      // 'world' has already been declared`. See Phase #196 follow-up.
      const allRedundantAlias = stmt.declarations.every((d) =>
        isRedundantWrapperAlias(d),
      );
      if (allRedundantAlias) continue;
    }
    residualStatements.push(stmtSource(stmt, source));
  }

  // Classify each flat add.
  const staticComponents: Record<string, unknown> = {};
  const calls: PrefabComponentCall[] = [];
  for (const add of flatAdds) {
    const c = classifyOneAdd(add, add.valueExpr as Expression);
    if (c.extractable && c.staticValue !== undefined) {
      // First write wins — chained `.add(e, C.X, ...)` for the same
      // component would clobber otherwise, but the engine semantics
      // are last-write-wins. Mirror that.
      staticComponents[c.componentName] = c.staticValue;
    }
    calls.push(c);
  }

  // Non-extractable adds go back into the residual as runnable JS.
  const residualAdds = calls
    .filter((c) => !c.extractable)
    .map((c) => c.residualSource)
    .join("\n");

  // Hoist closure-captured const declarations from the wrapping
  // `export default (api) => { ... }` body when the residual JS
  // references their bound identifiers. Without this, helpers like
  // `defaultCamera()` in default-pack's player.js end up with no
  // binding in the init script and crash at first spawn.
  const residualText = [residualStatements.join("\n"), residualAdds].join("\n");
  for (const sib of reg.closureSiblings) {
    if (sib.type !== "VariableDeclaration") continue;
    for (const d of sib.declarations) {
      if (d.id.type !== "Identifier") continue;
      const name = d.id.name;
      // Skip references to `api` (the wrapper supplies it as a param).
      if (name === "api") continue;
      // Cheap reference check — identifier appears as a whole word in
      // the residual text. Avoids importing a full scope analyser.
      const wordRe = new RegExp(`\\b${escapeRegExp(name)}\\b`);
      if (wordRe.test(residualText)) {
        closureHoists.push(stmtSource(sib, source));
        break;
      }
    }
  }

  const residualBody = [
    closureHoists.join("\n"),
    residualStatements.join("\n"),
    residualAdds,
  ]
    .filter((s) => s.trim().length > 0)
    .join("\n");

  return {
    name: reg.name,
    calls,
    staticComponents,
    residualBody,
    leadingComments: fileLeadingComments,
    tooDynamic: Object.keys(staticComponents).length === 0,
    totalCalls: calls.length,
    extractedCount: Object.keys(staticComponents).length,
  };
}

/**
 * `true` when a `VariableDeclarator` re-declares an alias the
 * init-script wrapper already provides — `const world = api.world` or
 * `const C = api.components`. Stripping these from the residual avoids
 * the duplicate-binding SyntaxError that crashes module load.
 */
function isRedundantWrapperAlias(
  d: { id: Node; init?: Expression | null },
): boolean {
  if (!d.init) return false;
  if (d.id.type !== "Identifier") return false;
  const name = d.id.name;
  if (name !== "world" && name !== "C") return false;
  const init = d.init;
  if (init.type !== "MemberExpression" || init.computed) return false;
  if (init.object.type !== "Identifier" || init.object.name !== "api") {
    return false;
  }
  if (init.property.type !== "Identifier") return false;
  if (name === "world") return init.property.name === "world";
  if (name === "C") return init.property.name === "components";
  return false;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * `true` when a `VariableDeclarator` re-declares an alias the
 * init-script wrapper already provides — `const world = api.world` or
 * `const C = api.components`. Stripping these from the residual avoids
 * the duplicate-binding SyntaxError that crashes module load.
 */
function isRedundantWrapperAlias(
  d: { id: Node; init?: Expression | null },
): boolean {
  if (!d.init) return false;
  if (d.id.type !== "Identifier") return false;
  const name = d.id.name;
  if (name !== "world" && name !== "C") return false;
  const init = d.init;
  if (init.type !== "MemberExpression" || init.computed) return false;
  if (init.object.type !== "Identifier" || init.object.name !== "api") {
    return false;
  }
  if (init.property.type !== "Identifier") return false;
  if (name === "world") return init.property.name === "world";
  if (name === "C") return init.property.name === "components";
  return false;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isWorldSpawnInit(init: Expression | null | undefined): boolean {
  if (!init) return false;
  if (init.type !== "CallExpression") return false;
  const callee = init.callee;
  if (callee.type !== "MemberExpression" || callee.computed) return false;
  if (
    callee.property.type !== "Identifier" ||
    callee.property.name !== "spawn"
  ) {
    return false;
  }
  // Matches `world.spawn()` and `api.world.spawn()`.
  return true;
}

/* -------------------------------------------------------------------- */
/*  Add-chain flattening                                                */
/* -------------------------------------------------------------------- */

/**
 * Walk a chained `world.add(e, C.X, v).add(e, C.Y, w)…` expression
 * and emit one `AddCallInfo` per `.add(...)` invocation. Returns
 * `null` if the expression isn't an add chain.
 *
 * Each emitted entry carries the same `statementSource` — that's the
 * full top-level statement's text. For chains that mix extractable
 * and non-extractable values the emitter cuts the chain back together
 * (residual-only) using `synthesizeResidualChain`.
 */
function flattenAddChain(
  expr: Expression,
  stmt: Statement,
  source: string,
): AddCallInfo[] | null {
  const adds: AddCallInfo[] = [];
  let cur: Expression = expr;
  while (cur.type === "CallExpression") {
    const callee = cur.callee;
    if (
      callee.type !== "MemberExpression" ||
      callee.computed ||
      callee.property.type !== "Identifier" ||
      callee.property.name !== "add"
    ) {
      break;
    }
    if (cur.arguments.length < 3) break;
    // 2nd arg is the component reference; 3rd is the value.
    const compArg = cur.arguments[1];
    const valArg = cur.arguments[2];
    if (!compArg || !valArg) break;
    const compName = extractComponentName(compArg);
    if (!compName) break;
    if (valArg.type === "SpreadElement") break;

    adds.push({
      componentName: compName,
      valueExpr: valArg,
      statementSource: stmtSource(stmt, source),
      valueSource: nodeSource(valArg as Located, source),
    });

    // Step inwards: the next outer call wraps the chain target.
    cur = callee.object as Expression;
  }
  // Reverse so the emit order matches source order (we walked
  // outermost → innermost which is reverse-source).
  return adds.length > 0 ? adds.reverse() : null;
}

/**
 * Pick the component name out of the second `world.add` argument.
 * Accepts:
 *   - `C.Position` (member, computed=false)
 *   - `api.components.Position`
 *   - bare `Position` (identifier)
 */
function extractComponentName(node: Node): string | null {
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression" && !node.computed) {
    if (node.property.type === "Identifier") return node.property.name;
  }
  return null;
}

/* -------------------------------------------------------------------- */
/*  Per-add classification                                              */
/* -------------------------------------------------------------------- */

function matchAddCall(
  expr: Expression,
  source: string,
): AddCallInfo | null {
  if (expr.type !== "CallExpression") return null;
  const callee = expr.callee;
  if (
    callee.type !== "MemberExpression" ||
    callee.computed ||
    callee.property.type !== "Identifier" ||
    callee.property.name !== "add"
  ) {
    return null;
  }
  if (expr.arguments.length < 3) return null;
  const compArg = expr.arguments[1];
  const valArg = expr.arguments[2];
  if (!compArg || !valArg) return null;
  const compName = extractComponentName(compArg);
  if (!compName) return null;
  if (valArg.type === "SpreadElement") return null;
  return {
    componentName: compName,
    valueExpr: valArg,
    statementSource: nodeSource(expr, source),
    valueSource: nodeSource(valArg as Located, source),
  };
}

function classifyOneAdd(
  add: AddCallInfo,
  valueExpr: Expression,
): PrefabComponentCall {
  const evaluated = tryEvaluateLiteral(valueExpr);
  if (evaluated.ok && isJsonSafe(evaluated.value)) {
    return {
      componentName: add.componentName,
      extractable: true,
      staticValue: evaluated.value,
      residualSource: "",
      leadingComment: add.leadingComment,
    };
  }
  // Non-extractable — synthesise a standalone `world.add(entity, C.X, <expr>)`
  // line from the per-link value source. Falling back to the full
  // statement source would duplicate the entire chain for every
  // non-extractable link in the chain. See Phase #196 follow-up.
  const residualSource = `world.add(entity, C.${add.componentName}, ${add.valueSource});`;
  return {
    componentName: add.componentName,
    extractable: false,
    reason: evaluated.ok
      ? "non-JSON-safe literal (Infinity/NaN)"
      : evaluated.reason,
    residualSource,
    leadingComment: add.leadingComment,
  };
}

/**
 * `JSON.stringify` collapses `Infinity` / `-Infinity` / `NaN` to `null`
 * (silently), which would corrupt static component values that fall
 * through to `manifest.prefabs[...].components`. Reject them at the
 * extraction seam so the residual init script preserves the original
 * runtime value via the regular `world.add(...)` path.
 *
 * Objects + arrays are checked recursively because pack authors love
 * sentinel values like `{ lastFireTime: -Infinity }` (default-pack's
 * `player.js` Weapon defaults).
 */
function isJsonSafe(value: unknown): boolean {
  if (value === null) return true;
  switch (typeof value) {
    case "number":
      return Number.isFinite(value);
    case "string":
    case "boolean":
      return true;
    case "undefined":
      // undefined drops the key on JSON.stringify — fine as a static
      // value because the engine's prefab loader skips undefined.
      return true;
    case "object":
      if (Array.isArray(value)) return value.every(isJsonSafe);
      for (const v of Object.values(value as Record<string, unknown>)) {
        if (!isJsonSafe(v)) return false;
      }
      return true;
    default:
      return false;
  }
}

/* -------------------------------------------------------------------- */
/*  Static evaluation                                                   */
/* -------------------------------------------------------------------- */

interface EvalResult {
  ok: boolean;
  value?: unknown;
  reason?: string;
}

/**
 * Conservative literal evaluator. Accepts:
 *  - number, string, boolean, null literals
 *  - unary `-N` / `+N` of a number literal
 *  - array literals containing recursively-extractable elements
 *  - object literals with `Identifier` / string-literal keys and
 *    recursively-extractable values
 *  - `new api.Vec2(x, y)` / `new Vec2(x, y)` with two literal args →
 *    `{ x, y }` (matches the engine's Position shorthand)
 *  - `new api.Vec2(x, y, z)` (rare) → `{ x, y, z }`
 *
 * Rejects every reference to a parameter, identifier (other than
 * `Math.PI` constants), property access, conditional, template
 * literal with expressions, etc. The rejection reason surfaces in
 * the converter UI so the user understands WHY a call wasn't
 * extractable.
 */
function tryEvaluateLiteral(expr: Node): EvalResult {
  switch (expr.type) {
    case "NumericLiteral":
    case "StringLiteral":
    case "BooleanLiteral":
      return { ok: true, value: expr.value };
    case "NullLiteral":
      return { ok: true, value: null };
    case "TemplateLiteral":
      if (expr.expressions.length === 0) {
        return { ok: true, value: expr.quasis[0]?.value.cooked ?? "" };
      }
      return { ok: false, reason: "template literal with interpolations" };
    case "UnaryExpression": {
      const inner = tryEvaluateLiteral(expr.argument as Node);
      if (
        inner.ok &&
        typeof inner.value === "number" &&
        (expr.operator === "-" || expr.operator === "+")
      ) {
        return {
          ok: true,
          value: expr.operator === "-" ? -inner.value : inner.value,
        };
      }
      return { ok: false, reason: `unary ${expr.operator}` };
    }
    case "ArrayExpression":
      return tryEvaluateArray(expr);
    case "ObjectExpression":
      return tryEvaluateObject(expr);
    case "NewExpression":
      return tryEvaluateNewExpression(expr as unknown as CallExpression);
    case "MemberExpression":
      // Allow `Math.PI` as a literal because pack authors use it for
      // initial Facing values. Everything else is dynamic.
      if (
        !expr.computed &&
        expr.object.type === "Identifier" &&
        expr.object.name === "Math" &&
        expr.property.type === "Identifier"
      ) {
        const name = expr.property.name;
        const value = (Math as unknown as Record<string, number>)[name];
        if (typeof value === "number") return { ok: true, value };
      }
      return { ok: false, reason: "dynamic property access" };
    case "BinaryExpression": {
      // Allow simple numeric arithmetic on two literals (e.g.
      // `Math.PI / 2`, `1 / 60`).
      const left = tryEvaluateLiteral(expr.left as Node);
      const right = tryEvaluateLiteral(expr.right as Node);
      if (
        left.ok &&
        right.ok &&
        typeof left.value === "number" &&
        typeof right.value === "number"
      ) {
        const l = left.value;
        const r = right.value;
        switch (expr.operator) {
          case "+":
            return { ok: true, value: l + r };
          case "-":
            return { ok: true, value: l - r };
          case "*":
            return { ok: true, value: l * r };
          case "/":
            return { ok: true, value: l / r };
          default:
            return { ok: false, reason: `binary ${expr.operator}` };
        }
      }
      return { ok: false, reason: "binary expression with non-literal operand" };
    }
    case "Identifier":
      // Allow well-known JS globals that the JSON serialiser preserves
      // cleanly: `undefined` drops the key, `Infinity` / `NaN` are
      // legitimate numeric defaults pack authors reach for (e.g.
      // `reloadStart: -Infinity` in default-pack's player prefab).
      if (expr.name === "undefined") return { ok: true, value: undefined };
      if (expr.name === "Infinity") return { ok: true, value: Infinity };
      if (expr.name === "NaN") return { ok: true, value: NaN };
      return { ok: false, reason: `identifier "${expr.name}" (dynamic)` };
    default:
      return { ok: false, reason: `unsupported expr type "${expr.type}"` };
  }
}

function tryEvaluateArray(expr: ArrayExpression): EvalResult {
  const out: unknown[] = [];
  for (const el of expr.elements) {
    if (el === null) {
      out.push(null);
      continue;
    }
    if (el.type === "SpreadElement") {
      return { ok: false, reason: "spread in array literal" };
    }
    const v = tryEvaluateLiteral(el);
    if (!v.ok) return { ok: false, reason: v.reason };
    out.push(v.value);
  }
  return { ok: true, value: out };
}

function tryEvaluateObject(expr: ObjectExpression): EvalResult {
  const out: Record<string, unknown> = {};
  for (const prop of expr.properties) {
    if (prop.type !== "ObjectProperty") {
      return { ok: false, reason: `unsupported object property type "${prop.type}"` };
    }
    if (prop.computed) {
      return { ok: false, reason: "computed object key" };
    }
    let key: string;
    if (prop.key.type === "Identifier") key = prop.key.name;
    else if (prop.key.type === "StringLiteral") key = prop.key.value;
    else if (prop.key.type === "NumericLiteral") key = String(prop.key.value);
    else return { ok: false, reason: `unsupported object key "${prop.key.type}"` };

    const v = tryEvaluateLiteral(prop.value as Node);
    if (!v.ok) return { ok: false, reason: v.reason };
    out[key] = v.value;
  }
  return { ok: true, value: out };
}

function tryEvaluateNewExpression(node: CallExpression): EvalResult {
  // `node` is typed CallExpression here only because Babel shares the
  // shape; we re-check via the runtime type.
  const expr = node as unknown as { type: string; callee: Node; arguments: Node[] };
  if (expr.type !== "NewExpression") {
    return { ok: false, reason: `unsupported new target "${expr.type}"` };
  }
  const callee = expr.callee;
  const name = extractVec2CalleeName(callee);
  if (!name || name !== "Vec2") {
    return { ok: false, reason: "non-Vec2 constructor" };
  }
  const args = expr.arguments;
  if (args.length < 2) {
    return { ok: false, reason: "Vec2 with <2 args" };
  }
  const xs: number[] = [];
  for (const arg of args) {
    const r = tryEvaluateLiteral(arg);
    if (!r.ok || typeof r.value !== "number") {
      return { ok: false, reason: r.reason ?? "Vec2 with non-numeric arg" };
    }
    xs.push(r.value);
  }
  if (xs.length === 2) return { ok: true, value: { x: xs[0]!, y: xs[1]! } };
  return { ok: true, value: { x: xs[0]!, y: xs[1]!, z: xs[2]! } };
}

function extractVec2CalleeName(node: Node): string | null {
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression" && !node.computed) {
    if (node.property.type === "Identifier") return node.property.name;
  }
  return null;
}

/* -------------------------------------------------------------------- */
/*  Source-text helpers                                                 */
/* -------------------------------------------------------------------- */

interface Located {
  start?: number | null;
  end?: number | null;
}

function stmtSource(stmt: Statement, source: string): string {
  return nodeSource(stmt as unknown as Located, source);
}

function nodeSource(node: Located, source: string): string {
  const start = node.start ?? 0;
  const end = node.end ?? source.length;
  return source.slice(start, end);
}

function extractFileLeadingComments(
  comments: ReadonlyArray<Comment>,
  source: string,
): string {
  // Collect every comment whose end position is before the first non-
  // comment statement. Babel's `comments` array is in source order.
  // The leading comments are the contiguous prefix that ends before
  // any real code.
  if (comments.length === 0) return "";
  // First non-whitespace, non-comment offset in `source`. We use a
  // simple regex: skip whitespace and `/* ... */` / `// ...` runs.
  let i = 0;
  const skipWhitespace = () => {
    while (i < source.length && /\s/.test(source[i]!)) i++;
  };
  skipWhitespace();
  // The end position of the last leading comment.
  let lastEnd = 0;
  for (const c of comments) {
    const start = c.start ?? 0;
    if (start !== i) break;
    const end = c.end ?? 0;
    lastEnd = end;
    i = end;
    skipWhitespace();
  }
  if (lastEnd === 0) return "";
  return source.slice(0, lastEnd).trim();
}

/* -------------------------------------------------------------------- */
/*  Init-script emitter                                                 */
/* -------------------------------------------------------------------- */

/**
 * Build a runnable ESM module body from the residual JS the converter
 * couldn't extract. The result is meant to drop into
 * `scripts/prefabs/<name>-init.js` and is what the engine's
 * `DeclarativePrefab.initScript` path imports.
 *
 * Wrap shape:
 *
 *   // ── leading comments preserved from the source ─────────────
 *   export default function init(entity, opts, api) {
 *     const world = api.world;
 *     const C = api.components;
 *     <residual statements verbatim>
 *   }
 *
 * The `world` / `C` aliases re-introduce the local bindings that the
 * JS-prefab body relied on, so the residual statements compile
 * unchanged. Pack authors are free to delete those if they prefer
 * `api.*` form.
 */
export function serializeInitScript(
  result: PrefabConversionResult,
): string {
  const lines: string[] = [];
  if (result.leadingComments) {
    lines.push(result.leadingComments);
    lines.push("");
  }
  lines.push("/**");
  lines.push(` * Auto-generated init script for prefab "${result.name}".`);
  lines.push(" *");
  lines.push(" * Static component data lives in the declarative");
  lines.push(" * `manifest.prefabs.<name>.components` block; this");
  lines.push(" * file holds the residual logic the converter couldn't");
  lines.push(" * extract (dynamic opts, helpers, branching). Engine");
  lines.push(" * calls this AFTER attaching the static components.");
  lines.push(" */");
  lines.push("export default function init(entity, opts, api) {");
  lines.push("  const world = api.world;");
  lines.push("  const C = api.components;");
  if (result.residualBody.trim().length === 0) {
    lines.push("  // (no residual logic — every component attached statically)");
  } else {
    // Indent each line two spaces for readability inside the function
    // body. Empty lines stay empty.
    for (const raw of result.residualBody.split("\n")) {
      const trimmed = raw.trimEnd();
      if (trimmed.length === 0) lines.push("");
      else lines.push("  " + trimmed);
    }
  }
  lines.push("}");
  lines.push("");
  return lines.join("\n");
}

/**
 * Canonical filesystem path for the init script generated from a
 * prefab named `name`. Matches the convention used in the editor's
 * file tree: `scripts/prefabs/<name>-init.js`.
 */
export function prefabInitScriptPath(name: string): string {
  // Sanitise so weird prefab ids ("foo bar / baz") still produce a
  // valid path. The engine uses these as keys, not arbitrary text,
  // so collapsing non-identifier chars to dashes is safe.
  const safe = name.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return `scripts/prefabs/${safe || "prefab"}-init.js`;
}
