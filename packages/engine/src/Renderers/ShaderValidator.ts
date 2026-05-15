/**
 * Build-time GLSL shader validator (M5 of MATERIALS.md, supersedes the
 * S5 sketch in ENGINE_PACK_SHADERS.md §9).
 *
 * Pure utility module — never imported by the runtime renderer. Lives
 * next to its renderer siblings because the canonical hook prelude +
 * header definitions are co-located. The validator reuses the SAME
 * `parseHookOverrides` + `hookPreludeFor` + `headerFor` /
 * `helpersFor` machinery the renderer uses at boot — so what the
 * validator approves and what the runtime compiles are the same bytes
 * (modulo the user body, which the pack-builder supplies).
 *
 * Two validation paths:
 *
 *   Path A — Real WebGL2 compile via `headless-gl` (npm package `gl`).
 *     Catches every error a runtime browser compile would (undeclared
 *     identifiers, type mismatches, missing semicolons, swizzle errors,
 *     …). REQUIRES the optional `gl` native binding to be installed.
 *
 *   Path B — Syntactic-only fallback.
 *     Hook signature checks + structural sanity (balanced braces, no
 *     `#version`, no duplicate engine-uniform redeclarations). Always
 *     works — no native deps. Misses runtime-only errors but catches
 *     the most common pack-author mistakes (wrong arity, typo'd uniform
 *     names DO get caught via the "undeclared identifier" check only
 *     in Path A; in Path B they'll surface at runtime instead).
 *
 * The validator tries Path A first; if `gl` isn't installed it
 * silently falls back to Path B and emits a single advisory line so
 * the pack author knows their CI can be tightened.
 */

import type { ShaderRole, ShaderHookRole, ShaderEntry } from "./ShaderRoleRegistry";
import { parseHookOverrides } from "./HookParser";
import { hookPreludeFor, hookNamesFor } from "./HookPrelude";
import { headerFor, helpersFor } from "./shaderHeaders";

/* ────────────────────────────────────────────────────────────────────
 * Public types
 * ────────────────────────────────────────────────────────────────── */

/**
 * Where (and why) a `.glsl` file is being validated. Carried into the
 * error report so the pack-builder can render a useful trail
 * ("preset X in walls.jsonc references shaders/Y.glsl which …").
 */
export interface ShaderValidationOrigin {
  /** Manifest-relative `.glsl` file path the validator was told to check. */
  shaderPath: string;
  /** Auto-injected-header role context: which role's prelude + helpers apply. */
  role: ShaderRole;
  /**
   * Pack manifest key that pointed at this file, e.g. `"worldHooks"`,
   * `"spriteFrag"`. Used for the diagnostic header.
   */
  manifestKey: ShaderEntry;
  /**
   * Optional human breadcrumb for nested references — preset id,
   * scene path, etc. Free-form; surfaces in error reports as the
   * "from" line.
   */
  source?: string;
}

/** One validation error tied to a single shader file. */
export interface ShaderValidationError {
  origin: ShaderValidationOrigin;
  /** One-line error summary printed at the top of the report block. */
  message: string;
  /** Optional GLSL source line number (1-based) — Path A only. */
  line?: number;
  /** Optional structured signature diff — Path B / signature errors. */
  signatureDiff?: {
    hookName: string;
    expected: string;
    actual: string;
  };
  /** Optional "did you mean" suggestion for typos in hook names. */
  suggestion?: string;
}

/** Result of validating one shader file. */
export interface ShaderValidationResult {
  origin: ShaderValidationOrigin;
  errors: ShaderValidationError[];
}

/** What's known about whether Path A is usable in this process. */
export interface BackendStatus {
  /** Did the optional `gl` package load + initialise? */
  realGLAvailable: boolean;
  /** Path B reason if A wasn't picked (install error, init error). */
  fallbackReason?: string;
}

/* ────────────────────────────────────────────────────────────────────
 * Hook signature extraction
 * ────────────────────────────────────────────────────────────────── */

/**
 * Parsed signature of a `hook_*` function — the bits we compare for
 * shape equivalence. Parameter NAMES are intentionally NOT compared
 * (GLSL doesn't care). Parameter TYPES (and the return type) must
 * match the canonical prelude byte-for-byte modulo whitespace.
 */
interface ParsedSignature {
  retType: string;
  paramTypes: string[];
  /** Original `vec3 base, vec2 uv` style — for error messages. */
  paramText: string;
}

/**
 * Extract `<retType> hook_NAME(<params>) {` from a single function
 * source. Returns `null` when the source doesn't have a hook-shaped
 * header (e.g. a stray `#define` made it into `parseHookOverrides`'s
 * output, which it shouldn't but defensive coding is cheap).
 */
function extractSignature(source: string): ParsedSignature | null {
  const m = /(\w+)\s+(hook_\w+)\s*\(([^)]*)\)/.exec(source);
  if (!m) return null;
  const retType = m[1]!;
  const paramsRaw = m[3]!.trim();
  if (paramsRaw === "" || paramsRaw === "void") {
    return { retType, paramTypes: [], paramText: "" };
  }
  const paramTypes: string[] = [];
  for (const part of paramsRaw.split(",")) {
    // Each `part` looks like `vec3 base` or `in vec3 base` —
    // strip trailing identifier (the parameter name) and any
    // `in`/`out`/`inout` qualifier.
    const tokens = part.trim().split(/\s+/);
    if (tokens.length === 0) continue;
    // Discard the trailing name; the rest is the type spec.
    const typeOnly = tokens.slice(0, -1).filter((t) => t !== "in" && t !== "out" && t !== "inout");
    paramTypes.push(typeOnly.join(" "));
  }
  return { retType, paramTypes, paramText: paramsRaw };
}

/**
 * Build the canonical-signature map for a role by parsing the role's
 * identity-default prelude exactly the way the runtime does. Returns
 * `name → ParsedSignature` for every catalogued hook. Built lazily +
 * cached per process.
 */
const canonicalSigCache = new Map<ShaderRole, Map<string, ParsedSignature>>();
function canonicalSignaturesFor(role: ShaderRole): Map<string, ParsedSignature> {
  const cached = canonicalSigCache.get(role);
  if (cached) return cached;
  const out = new Map<string, ParsedSignature>();
  const prelude = hookPreludeFor(role);
  const defs = parseHookOverrides(prelude);
  for (const [name, source] of defs) {
    const sig = extractSignature(source);
    if (sig) out.set(name, sig);
  }
  canonicalSigCache.set(role, out);
  return out;
}

/* ────────────────────────────────────────────────────────────────────
 * "Did you mean" suggestion — small Levenshtein for hook-name typos.
 * Mirrors the algorithm used elsewhere in the codebase for preset-
 * field suggestions; kept inline to avoid a cross-module dep.
 * ────────────────────────────────────────────────────────────────── */

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

function suggestHookName(unknown: string, role: ShaderRole): string | undefined {
  const names = hookNamesFor(role);
  let best: { name: string; dist: number } | null = null;
  for (const cand of names) {
    const d = levenshtein(unknown, cand);
    if (best === null || d < best.dist) best = { name: cand, dist: d };
  }
  // Only surface a suggestion when the edit distance is reasonable —
  // otherwise it's noise.
  if (!best) return undefined;
  return best.dist <= 5 ? best.name : undefined;
}

/* ────────────────────────────────────────────────────────────────────
 * Path A — opportunistic real WebGL2 compile via `headless-gl`.
 *
 * The `gl` package is an OPTIONAL devDependency. On platforms where
 * its node-gyp build succeeds (Linux x64 most commonly), the
 * validator gets full GLSL semantic-error coverage. On platforms
 * where it fails (e.g. ARM Linux without X11 dev headers, the user's
 * Pi dev box), the import throws at load and Path B takes over.
 *
 * The `tryLoadHeadlessGL` function MUST be idempotent and side-
 * effect-free on the cold path — pack-builder calls it once per
 * build, not per shader.
 * ────────────────────────────────────────────────────────────────── */

interface HeadlessGLBackend {
  /**
   * Compile `source` as a fragment shader; on success return `null`,
   * on failure return the GLSL info-log string.
   */
  compileFrag: (source: string) => string | null;
  /** Free the underlying GL context. */
  dispose: () => void;
}

let backendCache: { ok: HeadlessGLBackend | null; reason?: string } | null = null;

/**
 * Lazily resolve the headless GL backend. Returns `null` and stores
 * a reason when the optional `gl` package isn't installed or fails to
 * create a context.
 *
 * Why a dynamic import? `gl` requires a node-gyp build of native
 * bindings; on platforms where it's not installed, a static import
 * would crash pack-builder. Dynamic import + try/catch lets us
 * silently skip it.
 */
async function tryLoadHeadlessGL(): Promise<{ backend: HeadlessGLBackend | null; reason?: string }> {
  if (backendCache !== null) {
    return { backend: backendCache.ok, reason: backendCache.reason };
  }
  try {
    // `gl` is an optional peer — wrap in `Function` to defeat the
    // bundler's static analysis. Bun + tsc both leave this alone.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const dyn = new Function("m", "return import(m)") as (m: string) => Promise<unknown>;
    const mod = (await dyn("gl")) as { default?: (w: number, h: number) => WebGL2RenderingContext | null };
    const create = mod.default;
    if (typeof create !== "function") {
      backendCache = { ok: null, reason: "gl module has no default export" };
      return { backend: null, reason: backendCache.reason };
    }
    const gl = create(1, 1);
    if (!gl) {
      backendCache = { ok: null, reason: "gl create returned null" };
      return { backend: null, reason: backendCache.reason };
    }
    const backend: HeadlessGLBackend = {
      compileFrag(source) {
        const sh = gl.createShader(gl.FRAGMENT_SHADER);
        if (!sh) return "createShader returned null";
        gl.shaderSource(sh, source);
        gl.compileShader(sh);
        const ok = gl.getShaderParameter(sh, gl.COMPILE_STATUS);
        if (!ok) {
          const log = gl.getShaderInfoLog(sh) ?? "(no info log)";
          gl.deleteShader(sh);
          return log;
        }
        gl.deleteShader(sh);
        return null;
      },
      dispose() {
        // `gl` doesn't expose a context-destroy that's portable across
        // versions; we drop the reference and let the GC collect.
      },
    };
    backendCache = { ok: backend };
    return { backend };
  } catch (err) {
    const reason = (err as Error).message ?? "unknown gl-import error";
    backendCache = { ok: null, reason };
    return { backend: null, reason };
  }
}

/* ────────────────────────────────────────────────────────────────────
 * Public API — `validateShaderSource` (one file) + `validateShaderFile`
 * (one file read from disk) + a coordinator that batches a pack.
 * ────────────────────────────────────────────────────────────────── */

/**
 * Validate a raw GLSL source string for a given origin. The caller
 * has already read the file and knows what role it targets — this
 * function never touches the filesystem.
 *
 * Always-run Path B checks:
 *   - Parse hook function definitions; for each, verify the name is
 *     in the role catalog and the signature matches the canonical.
 *   - Reject `#version` directives (the engine prepends one — a
 *     duplicate is a compile error in WebGL2).
 *   - Reject re-declarations of engine-provided uniforms (e.g. a
 *     pack hooks file accidentally adding `uniform vec2 u_resolution;`
 *     is a duplicate-decl compile error).
 *   - For Mode 3 (hook files): reject any non-`hook_*` top-level
 *     function declarations? — NO, helpers are fine, the parser
 *     already ignores them.
 *
 * Optional Path A pass (only when `backend` is non-null):
 *   - Assemble header + prelude (with this file's overrides spliced
 *     in for hook files, or as Mode-1 body for full-role files) +
 *     helpers + a no-op `main()` placeholder, then compile.
 *
 * `engineBody` is optional. For hook files we don't NEED a real
 * engine body to compile — a minimal `void main() { outColor = vec4(0); }`
 * is enough to exercise hook bodies, since helpers + hook prelude
 * already declare every symbol the hook can reference. For Mode 1
 * the caller can pass the actual engine body if they want to
 * compile-test the pack-supplied `main()` against the header.
 */
export async function validateShaderSource(
  source: string,
  origin: ShaderValidationOrigin,
  opts: {
    /** Use this WebGL2 backend to attempt a real compile. */
    backend?: HeadlessGLBackend | null;
    /** Engine body for full-role replacement (Mode 1) — optional. */
    engineBody?: string;
  } = {},
): Promise<ShaderValidationResult> {
  const errors: ShaderValidationError[] = [];
  const role = origin.role;
  const isHookFile = (origin.manifestKey as string).endsWith("Hooks");

  // ── Path B — structural sanity ────────────────────────────────
  // Strip block comments before scanning for `#version` so a pack
  // can legally write `/* #version disabled */` somewhere.
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, "");

  if (/#\s*version\b/.test(stripped)) {
    errors.push({
      origin,
      message:
        "shader file contains a `#version` directive — the engine prepends one; remove this line",
    });
  }

  // ── Path B — duplicate engine-uniform redeclaration ──────────
  // We don't try to fully parse GLSL — we look for top-level
  // `uniform <type> u_NAME` declarations in the file and check
  // whether the same name appears in the role's auto-injected
  // header. This catches the most common copy-paste error of
  // pasting an engine uniform into a hook file.
  const engineHeader = headerFor(role);
  const engineUniforms = new Set<string>();
  for (const m of engineHeader.matchAll(/\buniform\s+[^;]*?\b(u_\w+)/g)) {
    engineUniforms.add(m[1]!);
  }
  for (const m of stripped.matchAll(/\buniform\s+[^;]*?\b(u_\w+)/g)) {
    const name = m[1]!;
    if (engineUniforms.has(name)) {
      errors.push({
        origin,
        message: `redeclares engine-provided uniform '${name}' (already declared in the auto-injected header)`,
      });
    }
  }

  // ── Path B — hook signature validation (Mode 3 / hook files) ──
  if (isHookFile) {
    const overrides = parseHookOverrides(source);
    const canonical = canonicalSignaturesFor(role);
    // Count of hooks in `overrides` that belong to THIS role — a
    // hook file referenced from both `worldHooks` and `spriteHooks`
    // can legitimately have zero of its hooks for the role being
    // validated right now (the other role's overrides live in the
    // same file). Surfacing "no hooks" only when there are also no
    // cross-role hooks present in the file would be too lax: if a
    // pack author shipped an empty hook file by mistake, ALL roles
    // would see "no hooks" and we'd want the error. Compromise:
    // surface "no hooks at all" only on a truly empty parse.
    if (overrides.size === 0) {
      errors.push({
        origin,
        message: "hook file contains no `hook_*` function definitions",
      });
    }
    // Catalog of EVERY role's hook names — used to silently filter
    // cross-role hooks. Mirrors the runtime behavior in
    // `ShaderInjection.ts`: a hook file referenced from both
    // `worldHooks` and `spriteHooks` slots (e.g. default-pack's
    // night-vision.glsl) legitimately contains both `hook_modifyFinalColor`
    // and `hook_modifySpriteFinalColor`. When validating against
    // `worldFrag`, the sprite-only hook is intended for the other
    // slot — drop it without error.
    const allKnownNames = new Set<string>();
    for (const r of ["worldFrag", "spriteFrag", "skyFrag"] as const) {
      for (const n of hookNamesFor(r)) allKnownNames.add(n);
    }
    for (const [name, src] of overrides) {
      const canon = canonical.get(name);
      if (!canon) {
        // Cross-role hook? Silently skip — it's for the file's
        // OTHER manifest slot. Only error when the name is unknown
        // to EVERY role (typo / wrong-spelling).
        if (allKnownNames.has(name)) continue;
        const sug = suggestHookName(name, role);
        errors.push({
          origin,
          message: `'${name}' is not a known hook for role '${role}'`,
          suggestion: sug,
        });
        continue;
      }
      const actual = extractSignature(src);
      if (!actual) {
        errors.push({
          origin,
          message: `failed to parse signature for '${name}'`,
        });
        continue;
      }
      if (!sigEquivalent(canon, actual)) {
        errors.push({
          origin,
          message: `${name}: wrong signature`,
          signatureDiff: {
            hookName: name,
            expected: formatSig(name, canon),
            actual: formatSig(name, actual),
          },
        });
      }
    }
  }

  // ── Path A — real compile via headless GL, if available ───────
  // We compile EVEN when Path B caught structural errors: if the
  // pack author fixes those, the build re-runs and Path A's deeper
  // diagnostics already cover the rest. Path A failures stack on
  // top of Path B failures in the report.
  const backend = opts.backend;
  if (backend) {
    const assembled = assembleForCompile(role, source, origin, opts.engineBody);
    const log = backend.compileFrag(assembled);
    if (log) {
      // Subtract the header line count from line refs in the log so
      // the line number matches the user's file. Best-effort —
      // headless-gl's log format varies a bit by driver.
      const headerLines = assembled.slice(0, assembled.indexOf(USER_BODY_MARKER)).split("\n").length;
      // Match either `ERROR: 0:14:` or `0:14:` style logs.
      const lineMatch = /(?:ERROR:?\s*\d+:|^\s*\d+:)(\d+):/m.exec(log);
      const fileLine = lineMatch ? Math.max(1, parseInt(lineMatch[1]!, 10) - headerLines) : undefined;
      errors.push({
        origin,
        message: `GLSL compile error: ${firstNonEmptyLine(log)}`,
        line: fileLine,
      });
    }
  }

  return { origin, errors };
}

/**
 * Convenience: read `shaderPath` (resolved by `readFile`) and run
 * `validateShaderSource`. Used by the pack-builder iteration loop.
 */
export async function validateShaderFile(
  origin: ShaderValidationOrigin,
  readFile: (path: string) => Promise<string>,
  opts: { backend?: HeadlessGLBackend | null; engineBody?: string } = {},
): Promise<ShaderValidationResult> {
  let source: string;
  try {
    source = await readFile(origin.shaderPath);
  } catch (err) {
    return {
      origin,
      errors: [
        {
          origin,
          message: `failed to read shader file: ${(err as Error).message}`,
        },
      ],
    };
  }
  return validateShaderSource(source, origin, opts);
}

/* ────────────────────────────────────────────────────────────────────
 * Backend lifecycle wrapper — pack-builder calls this once per build,
 * carries the result through every per-shader validateShaderFile().
 * ────────────────────────────────────────────────────────────────── */

/**
 * Resolve the validation backend for this run. Returns `null` plus a
 * reason when Path A is unavailable. The caller can pass `null` into
 * `validateShaderSource` to skip the real-compile pass — Path B
 * checks still run.
 */
export async function resolveShaderBackend(): Promise<{
  backend: HeadlessGLBackend | null;
  status: BackendStatus;
}> {
  const { backend, reason } = await tryLoadHeadlessGL();
  return {
    backend,
    status: {
      realGLAvailable: backend !== null,
      fallbackReason: reason,
    },
  };
}

/* ────────────────────────────────────────────────────────────────────
 * Error rendering — terminal-friendly multi-line block per error.
 * Pack-builder collects errors and renders at the end of the build.
 * ────────────────────────────────────────────────────────────────── */

/**
 * Render a single validation error as the multi-line block shown in
 * the report. The format mirrors the example in MATERIALS.md / the
 * spec for the M5 task:
 *
 *     X path/to/file.glsl
 *        from: <origin.source>
 *        <message>
 *        [optional sig diff]
 *        [optional "did you mean"]
 */
export function formatValidationError(err: ShaderValidationError): string {
  const lines: string[] = [];
  lines.push(`X ${err.origin.shaderPath}`);
  if (err.origin.source) {
    lines.push(`   from: ${err.origin.source}`);
  }
  if (err.line !== undefined) {
    lines.push(`   line ${err.line}: ${err.message}`);
  } else {
    lines.push(`   ${err.message}`);
  }
  if (err.signatureDiff) {
    lines.push(`     pack:   ${err.signatureDiff.actual}`);
    lines.push(`     engine: ${err.signatureDiff.expected}`);
  }
  if (err.suggestion) {
    lines.push(`     did you mean: ${err.suggestion}`);
  }
  return lines.join("\n");
}

/* ────────────────────────────────────────────────────────────────────
 * Internal helpers
 * ────────────────────────────────────────────────────────────────── */

/**
 * Are two parsed signatures equivalent under the rules above (return
 * type + parameter-type sequence; names ignored, whitespace
 * normalised)?
 */
function sigEquivalent(a: ParsedSignature, b: ParsedSignature): boolean {
  if (a.retType !== b.retType) return false;
  if (a.paramTypes.length !== b.paramTypes.length) return false;
  for (let i = 0; i < a.paramTypes.length; i++) {
    if (a.paramTypes[i] !== b.paramTypes[i]) return false;
  }
  return true;
}

function formatSig(name: string, sig: ParsedSignature): string {
  return `${sig.retType} ${name}(${sig.paramText})`;
}

function firstNonEmptyLine(s: string): string {
  for (const line of s.split("\n")) {
    const t = line.trim();
    if (t.length > 0) return t;
  }
  return s;
}

/**
 * Sentinel inserted between the auto-injected header / prelude /
 * helpers and the user body. We use it to subtract header lines from
 * compile-error line numbers so the reported line maps back to the
 * pack author's source.
 */
const USER_BODY_MARKER = "// ==== user body begins ====\n";

/**
 * Assemble a compile-ready GLSL string for Path A. Mirrors what
 * `assembleShaderSource` does at runtime, but the validator doesn't
 * have access to a live `AssetPack`, so we splice the file's hook
 * overrides directly into the prelude and use a minimal placeholder
 * `main()`. For Mode-1 (full role replacement) we use the
 * caller-supplied `engineBody` if any, falling back to a placeholder.
 *
 * The assembled source intentionally does NOT include any pack-level
 * Hooks substitutions from OTHER files — each `.glsl` is validated
 * in isolation. That keeps Path A's error attribution clean: a
 * compile error in `foo.glsl` is about `foo.glsl`, not its sibling.
 */
function assembleForCompile(
  role: ShaderRole,
  source: string,
  origin: ShaderValidationOrigin,
  engineBody?: string,
): string {
  const header = headerFor(role);
  const helpers = helpersFor(role);
  const prelude = hookPreludeFor(role);
  const isHookFile = (origin.manifestKey as string).endsWith("Hooks");

  let finalPrelude = prelude;
  let body = engineBody ?? PLACEHOLDER_BODY[role];
  if (isHookFile) {
    const overrides = parseHookOverrides(source);
    finalPrelude = spliceOverrides(prelude, overrides);
  } else {
    // Mode 1 — pack supplies the body. The file IS the body.
    body = source;
  }

  return header + finalPrelude + helpers + USER_BODY_MARKER + body;
}

/**
 * Splice each named override into the prelude, replacing the
 * identity-default function. Unknown names are dropped (the Path B
 * pass already reports them).
 */
function spliceOverrides(prelude: string, overrides: Map<string, string>): string {
  let out = prelude;
  for (const [name, overrideSrc] of overrides) {
    const re = new RegExp(`(\\w+)\\s+${name}\\s*\\([^)]*\\)\\s*\\{`);
    const m = re.exec(out);
    if (!m) continue;
    // Walk balanced braces from `{` to find the end of the original.
    let i = m.index + m[0].length;
    let depth = 1;
    while (i < out.length && depth > 0) {
      const c = out[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      i++;
    }
    out = out.slice(0, m.index) + overrideSrc + out.slice(i);
  }
  return out;
}

/**
 * Minimal `main()` per role — used by Path A when validating a hook
 * file in isolation. Each role's placeholder declares the right
 * `outColor` output and otherwise touches nothing; the surrounding
 * helpers + hooks supply every symbol the GLSL compiler needs.
 */
const PLACEHOLDER_BODY: Record<ShaderRole, string> = {
  skyFrag: `void main() { outColor = vec4(0.0, 0.0, 0.0, 1.0); }\n`,
  worldFrag: `void main() { outColor = vec4(0.0, 0.0, 0.0, 1.0); }\n`,
  spriteFrag: `void main() { outColor = vec4(0.0, 0.0, 0.0, 1.0); }\n`,
};

/* ────────────────────────────────────────────────────────────────────
 * Pack-level coordinator — walks manifest.shaders + preset shader
 * blocks + scene shader blocks. Pack-builder calls this once.
 * ────────────────────────────────────────────────────────────────── */

/** A reference to a `.glsl` file the validator should check. */
export interface ShaderRefToValidate {
  /** Manifest-relative path. */
  path: string;
  /** Role context — drives prelude + helper selection. */
  role: ShaderRole;
  /** Manifest key the path came from. */
  manifestKey: ShaderEntry;
  /** Free-form breadcrumb for diagnostics. */
  source?: string;
}

/**
 * Collect every `.glsl` reference from the pack manifest, presets,
 * and scenes. Each reference is validated in isolation. Returns the
 * flat list — callers de-duplicate before validation (a single file
 * referenced from manifest + N presets is still one validation pass,
 * but every origin is reported in the error trail).
 */
export function collectShaderReferences(
  manifest: { shaders?: Partial<Record<ShaderEntry, string>> },
  presets?: Iterable<{ id: string; file: string; shader?: Partial<Record<ShaderHookRole, string>> | string }>,
  scenes?: Iterable<{ path: string; shaders?: Partial<Record<ShaderHookRole, string>> }>,
): ShaderRefToValidate[] {
  const out: ShaderRefToValidate[] = [];

  // --- manifest.shaders --------------------------------------------
  const manShaders = manifest.shaders ?? {};
  for (const [key, path] of Object.entries(manShaders) as [ShaderEntry, string][]) {
    const role = roleForEntry(key);
    if (!role) continue;
    out.push({ path, role, manifestKey: key, source: `manifest.shaders.${key}` });
  }

  // --- preset.shader -----------------------------------------------
  // M2 (in parallel) is adding `shader` to presets. Today the field
  // may be undefined; tomorrow it'll either be a string (shorthand =
  // worldHooks) or a `{worldHooks, spriteHooks, skyHooks}` block.
  if (presets) {
    for (const p of presets) {
      if (!p.shader) continue;
      if (typeof p.shader === "string") {
        out.push({
          path: p.shader,
          role: "worldFrag",
          manifestKey: "worldHooks",
          source: `${p.file}: preset "${p.id}".shader`,
        });
        continue;
      }
      for (const [hookKey, hookPath] of Object.entries(p.shader)) {
        if (typeof hookPath !== "string") continue;
        const role = roleForEntry(hookKey as ShaderEntry);
        if (!role) continue;
        out.push({
          path: hookPath,
          role,
          manifestKey: hookKey as ShaderEntry,
          source: `${p.file}: preset "${p.id}".shader.${hookKey}`,
        });
      }
    }
  }

  // --- scene.shaders -----------------------------------------------
  // M3 (in parallel) is adding `shaders` to scene JSON. Same shape
  // as manifest.shaders, hooks-only.
  if (scenes) {
    for (const s of scenes) {
      if (!s.shaders) continue;
      for (const [hookKey, hookPath] of Object.entries(s.shaders)) {
        if (typeof hookPath !== "string") continue;
        const role = roleForEntry(hookKey as ShaderEntry);
        if (!role) continue;
        out.push({
          path: hookPath,
          role,
          manifestKey: hookKey as ShaderEntry,
          source: `${s.path}: scene.shaders.${hookKey}`,
        });
      }
    }
  }

  return out;
}

function roleForEntry(entry: ShaderEntry): ShaderRole | null {
  switch (entry) {
    case "skyFrag":
    case "skyHooks":
      return "skyFrag";
    case "worldFrag":
    case "worldHooks":
      return "worldFrag";
    case "spriteFrag":
    case "spriteHooks":
      return "spriteFrag";
    default:
      return null;
  }
}
