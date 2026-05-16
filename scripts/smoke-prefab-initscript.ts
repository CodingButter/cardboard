#!/usr/bin/env bun
/**
 * Phase #196 engine smoke test — hybrid declarative prefabs with
 * `initScript`. Covers `packages/engine/src/AssetPack/registerDeclarativePrefabs.ts`
 * and the `DeclarativePrefab.initScript` field on `types.ts`.
 *
 * Hybrid prefabs mix static component data (declared in
 * `manifest.prefabs[id].components`) with an imperative init script
 * (referenced via `manifest.prefabs[id].initScript`) that runs AFTER
 * the static components have been attached. The script's default
 * export receives `(entity, opts, api)` and can read live component
 * values, attach extra components, or roll in `opts`-driven data the
 * declarative side doesn't know how to merge.
 *
 * Test matrix:
 *   1. Happy path — manifest with both static components AND an
 *      initScript. Register via the async variant (pre-warms the
 *      script load), spawn, assert the entity carries both the
 *      static components AND the init-script-added one. The init
 *      script reads the static-attached Position value to confirm
 *      ordering.
 *   2. opts pass-through — init script sees the exact opts object
 *      the caller handed to `api.spawn(name, opts)`.
 *   3. initScript that throws — error is logged, spawn still returns
 *      the entity, static components remain attached.
 *   4. Sync path fallback — the original sync
 *      `registerDeclarativePrefabs` works without an initScript and
 *      handles a present-but-missing-from-pack initScript path
 *      gracefully (warn + entity still spawns).
 *   5. Idempotency — `_resetInitScriptCache` lets us re-register the
 *      same prefab with a different init-script body and observe the
 *      new behaviour.
 *
 * Run:
 *   bun run scripts/smoke-prefab-initscript.ts
 */

import {
  AssetPack,
  registerDeclarativePrefabs,
  registerDeclarativePrefabsAsync,
  _resetInitScriptCache,
  type DeclarativePrefab,
  type PackManifest,
} from "../packages/engine/src/index";

let passed = 0;
let failed = 0;

function assert(cond: unknown, message: string): asserts cond {
  if (cond) {
    passed += 1;
    console.log(`  ok  ${message}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${message}`);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  const eq = JSON.stringify(actual) === JSON.stringify(expected);
  if (eq) {
    passed += 1;
    console.log(`  ok  ${message}`);
  } else {
    failed += 1;
    console.error(
      `  FAIL ${message}\n    expected ${JSON.stringify(expected)}` +
        `\n    actual   ${JSON.stringify(actual)}`,
    );
  }
}

// ── Stub ModAPI (mirrors smoke-declarative-prefabs.ts) ─────────────

interface RecordedAdd {
  entity: number;
  componentName: string;
  value: unknown;
}

interface StubComponent {
  __name: string;
}

interface StubAPI {
  world: {
    spawn: () => number;
    add: (e: number, c: StubComponent, v: unknown) => StubAPI["world"];
  };
  registerPrefab: (
    name: string,
    factory: (...args: unknown[]) => number,
  ) => void;
  spawn: (name: string, ...args: unknown[]) => number;
  getComponent: (name: string) => StubComponent | undefined;
  __components: Map<string, StubComponent>;
  __prefabs: Map<string, (...args: unknown[]) => number>;
  __recorded: RecordedAdd[];
  __marker: string;
}

function makeStubAPI(
  knownComponents: ReadonlyArray<string>,
  marker = "stub",
): StubAPI {
  const compMap = new Map<string, StubComponent>();
  for (const n of knownComponents) compMap.set(n, { __name: n });
  const prefabs = new Map<string, (...args: unknown[]) => number>();
  const recorded: RecordedAdd[] = [];
  let nextEntity = 1;

  const api: StubAPI = {
    __components: compMap,
    __prefabs: prefabs,
    __recorded: recorded,
    __marker: marker,
    world: {
      spawn: () => nextEntity++,
      add(entity, comp, value) {
        recorded.push({
          entity,
          componentName: (comp as StubComponent).__name,
          value,
        });
        return this;
      },
    },
    registerPrefab(name, factory) {
      prefabs.set(name, factory);
    },
    spawn(name, ...args) {
      const f = prefabs.get(name);
      if (!f) throw new Error(`No prefab named "${name}"`);
      return f(...args);
    },
    getComponent(name) {
      return compMap.get(name);
    },
  };
  return api;
}

function recordedFor(api: StubAPI, entity: number) {
  return api.__recorded.filter((r) => r.entity === entity);
}

// ── Stub AssetPack — in-memory backing for textBody / has ──────────

class StubAssetPack extends AssetPack {
  readonly manifest: PackManifest;
  private files = new Map<string, string>();

  constructor(manifest: PackManifest, files: Record<string, string> = {}) {
    super();
    this.manifest = manifest;
    for (const [k, v] of Object.entries(files)) this.files.set(k, v);
  }

  setFile(path: string, body: string): void {
    this.files.set(path, body);
  }

  async textureBlob(path: string): Promise<Blob> {
    const body = this.files.get(path);
    if (body === undefined) throw new Error(`Missing: ${path}`);
    return new Blob([body]);
  }

  async textBody(path: string): Promise<string> {
    const body = this.files.get(path);
    if (body === undefined) throw new Error(`Missing: ${path}`);
    return body;
  }

  has(path: string): boolean {
    return this.files.has(path);
  }
}

function manifestWith(
  prefabs: Record<string, DeclarativePrefab>,
): PackManifest {
  return {
    name: "init-script-smoke",
    version: "0.0.1",
    tileTextures: {},
    tileSheets: [],
    startScene: "scenes/none.json",
    prefabs,
  };
}

// ── 1. Happy path ──────────────────────────────────────────────────

console.log(
  "Test 1 — static components + initScript both attach; script runs AFTER static.",
);
{
  _resetInitScriptCache();
  const api = makeStubAPI([
    "Position",
    "Sprite",
    "Health",
    "Tag",
  ]);

  // Init script default-exports a function that:
  //  - reads the static Position component the engine attached,
  //  - attaches a Health component derived from opts.maxHp ?? 100,
  //  - attaches a Tag component carrying the read Position.x.
  // It does that against the ModAPI handed in as the third arg.
  const initSource = `
    export default function init(entity, opts, api) {
      const records = api.__recorded.filter((r) => r.entity === entity);
      const pos = records.find((r) => r.componentName === "Position");
      const x = pos?.value?.x;
      const maxHp = opts.maxHp ?? 100;
      api.world.add(entity, api.getComponent("Health"), { hp: maxHp, maxHp });
      api.world.add(entity, api.getComponent("Tag"), { observedX: x });
    }
  `;

  const prefab: DeclarativePrefab = {
    name: "zombie",
    components: {
      Position: { x: 3, y: 7, z: 0 },
      Sprite: { imageId: "zombie", scale: 1 },
    },
    initScript: "scripts/prefabs/zombie-init.js",
  };

  const pack = new StubAssetPack(manifestWith({ zombie: prefab }), {
    "scripts/prefabs/zombie-init.js": initSource,
  });

  await registerDeclarativePrefabsAsync(
    api as unknown as Parameters<typeof registerDeclarativePrefabsAsync>[0],
    pack.manifest,
    pack,
  );

  assert(api.__prefabs.has("zombie"), "zombie prefab registered");

  const entity = api.spawn("zombie", { maxHp: 75 });
  const recs = recordedFor(api, entity);
  const byName = Object.fromEntries(
    recs.map((r) => [r.componentName, r.value]),
  );

  // Static attachment landed (declarative)
  const pos = byName.Position as { x: number; y: number; z: number };
  assertEqual(pos.x, 3, "static Position.x attached");
  assertEqual(pos.y, 7, "static Position.y attached");
  assertEqual(
    byName.Sprite,
    { imageId: "zombie", scale: 1 },
    "static Sprite attached",
  );

  // Init-script attachment landed (imperative)
  assertEqual(
    byName.Health,
    { hp: 75, maxHp: 75 },
    "Health attached by initScript with opts.maxHp",
  );

  // Ordering — script saw the static Position
  assertEqual(
    byName.Tag,
    { observedX: 3 },
    "initScript saw static Position before its own writes",
  );

  // Sanity: the recorded order has Position + Sprite BEFORE Health + Tag.
  const order = recs.map((r) => r.componentName);
  const posIdx = order.indexOf("Position");
  const healthIdx = order.indexOf("Health");
  assert(
    posIdx < healthIdx,
    `Position (${posIdx}) attached before Health (${healthIdx})`,
  );
}

// ── 2. opts.maxHp falls back to 100 when omitted ──────────────────

console.log(
  "\nTest 2 — initScript uses opts default when caller omits the field.",
);
{
  _resetInitScriptCache();
  const api = makeStubAPI([
    "Position",
    "Sprite",
    "Health",
    "Tag",
  ]);
  const initSource = `
    export default (entity, opts, api) => {
      const maxHp = opts.maxHp ?? 100;
      api.world.add(entity, api.getComponent("Health"), { hp: maxHp, maxHp });
    };
  `;
  const prefab: DeclarativePrefab = {
    name: "z2",
    components: { Position: { x: 0, y: 0 } },
    initScript: "scripts/prefabs/z2-init.js",
  };
  const pack = new StubAssetPack(manifestWith({ z2: prefab }), {
    "scripts/prefabs/z2-init.js": initSource,
  });
  await registerDeclarativePrefabsAsync(
    api as unknown as Parameters<typeof registerDeclarativePrefabsAsync>[0],
    pack.manifest,
    pack,
  );
  const e = api.spawn("z2", {}); // no opts.maxHp
  const recs = recordedFor(api, e);
  const health = recs.find((r) => r.componentName === "Health")!.value;
  assertEqual(health, { hp: 100, maxHp: 100 }, "default opts honoured");
}

// ── 3. initScript throws → log + entity still has static comps ────

console.log(
  "\nTest 3 — initScript throw is caught; static components stay attached.",
);
{
  _resetInitScriptCache();
  const api = makeStubAPI(["Position", "Sprite"]);
  const initSource = `
    export default function init() {
      throw new Error("boom");
    }
  `;
  const prefab: DeclarativePrefab = {
    name: "broken",
    components: {
      Position: { x: 1, y: 1 },
      Sprite: { imageId: "x" },
    },
    initScript: "scripts/prefabs/broken-init.js",
  };
  const pack = new StubAssetPack(manifestWith({ broken: prefab }), {
    "scripts/prefabs/broken-init.js": initSource,
  });

  // Capture console.error
  const originalErr = console.error;
  const errs: string[] = [];
  console.error = (...args: unknown[]) => {
    errs.push(args.map(String).join(" "));
  };
  try {
    await registerDeclarativePrefabsAsync(
      api as unknown as Parameters<typeof registerDeclarativePrefabsAsync>[0],
      pack.manifest,
      pack,
    );
    let e: number | undefined;
    let threw = false;
    try {
      e = api.spawn("broken", {});
    } catch {
      threw = true;
    }
    assert(!threw, "spawn returns even when initScript throws");
    assert(e !== undefined, "entity id returned");
    if (e !== undefined) {
      const recs = recordedFor(api, e);
      const names = recs.map((r) => r.componentName).sort();
      assertEqual(
        names,
        ["Position", "Sprite"],
        "static components remain attached after initScript throw",
      );
    }
    assert(
      errs.some((m) => m.includes("initScript threw")),
      "console.error fired for initScript throw",
    );
  } finally {
    console.error = originalErr;
  }
}

// ── 4. Missing-from-pack initScript path → warn + spawn ───────────

console.log(
  "\nTest 4 — initScript path absent from pack is a non-fatal warning.",
);
{
  _resetInitScriptCache();
  const api = makeStubAPI(["Position"]);
  const prefab: DeclarativePrefab = {
    name: "nofile",
    components: { Position: { x: 0, y: 0 } },
    initScript: "scripts/prefabs/missing.js",
  };
  // Build the pack without putting the initScript body in `files`.
  const pack = new StubAssetPack(manifestWith({ nofile: prefab }), {});

  const originalErr = console.error;
  const errs: string[] = [];
  console.error = (...args: unknown[]) => {
    errs.push(args.map(String).join(" "));
  };
  try {
    await registerDeclarativePrefabsAsync(
      api as unknown as Parameters<typeof registerDeclarativePrefabsAsync>[0],
      pack.manifest,
      pack,
    );
    const e = api.spawn("nofile", {});
    const recs = recordedFor(api, e);
    assertEqual(
      recs.map((r) => r.componentName),
      ["Position"],
      "Position still attached when initScript is missing",
    );
    assert(
      errs.some((m) => m.includes("not present in pack")),
      "console.error fired for missing initScript",
    );
  } finally {
    console.error = originalErr;
  }
}

// ── 5. Sync path without initScript still works ───────────────────

console.log("\nTest 5 — sync registerDeclarativePrefabs without initScript.");
{
  _resetInitScriptCache();
  const api = makeStubAPI(["Position", "Sprite"]);
  const prefab: DeclarativePrefab = {
    name: "plain",
    components: {
      Position: { x: 5, y: 5 },
      Sprite: { imageId: "torch" },
    },
  };
  const pack = new StubAssetPack(manifestWith({ plain: prefab }), {});
  registerDeclarativePrefabs(
    api as unknown as Parameters<typeof registerDeclarativePrefabs>[0],
    pack.manifest,
    pack,
  );
  const e = api.spawn("plain", {});
  const recs = recordedFor(api, e);
  const names = recs.map((r) => r.componentName).sort();
  assertEqual(
    names,
    ["Position", "Sprite"],
    "sync path attaches static components without initScript",
  );
}

// ── 6. Sync path with initScript — async load, sync spawn returns ─

console.log(
  "\nTest 6 — sync path with initScript fires-and-forgets; spawn returns entity immediately.",
);
{
  _resetInitScriptCache();
  const api = makeStubAPI(["Position", "Health"]);
  const initSource = `
    export default (entity, opts, api) => {
      api.world.add(entity, api.getComponent("Health"), { hp: 50 });
    };
  `;
  const prefab: DeclarativePrefab = {
    name: "lazy",
    components: { Position: { x: 0, y: 0 } },
    initScript: "scripts/prefabs/lazy-init.js",
  };
  const pack = new StubAssetPack(manifestWith({ lazy: prefab }), {
    "scripts/prefabs/lazy-init.js": initSource,
  });
  registerDeclarativePrefabs(
    api as unknown as Parameters<typeof registerDeclarativePrefabs>[0],
    pack.manifest,
    pack,
  );
  // Spawn synchronously; Position should be there immediately.
  const e = api.spawn("lazy", {});
  const immediate = recordedFor(api, e).map((r) => r.componentName);
  assert(
    immediate.includes("Position"),
    "static Position attached synchronously on first spawn",
  );
  // Wait for any pending init promises to settle, then re-check.
  await new Promise((resolve) => setTimeout(resolve, 10));
  const after = recordedFor(api, e).map((r) => r.componentName).sort();
  assertEqual(
    after,
    ["Health", "Position"],
    "init-script Health attached after microtask",
  );
}

console.log();
console.log(
  `Prefab-initScript smoke test: ${passed} passed, ${failed} failed`,
);
if (failed > 0) process.exit(1);
