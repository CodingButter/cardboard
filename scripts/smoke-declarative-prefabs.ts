#!/usr/bin/env bun
/**
 * Engine smoke test — `registerDeclarativePrefabs` end-to-end.
 *
 * Covers EDITOR.md §6.3 + `packages/engine/src/AssetPack/registerDeclarativePrefabs.ts`.
 * Builds a stub `ModAPI` (no canvas, no GL, no audio context) wired
 * just enough to exercise the registration path, then:
 *
 *   1. Loads a manifest with one declarative prefab (Position + Sprite + Light)
 *      via `registerDeclarativePrefabs(api, manifest)`.
 *   2. Asserts the prefab was registered against the stub registry.
 *   3. Invokes the prefab through `api.spawn("test_prefab", {})` and
 *      asserts the spawned entity carries the three components with the
 *      data declared in the manifest.
 *   4. Re-invokes with spawn-time options `{ x: 7, y: 8 }` and asserts
 *      the Position shorthand merges (rolling x/y into Position).
 *   5. Asserts the well-known `opts.facing` shorthand rolls into Facing.
 *   6. Asserts that a prefab referencing an unknown component logs a
 *      warning, skips that component, and still spawns the rest.
 *   7. Asserts `registerDeclarativePrefabs` on a manifest without a
 *      `prefabs` field is a no-op (no throws, no registrations).
 *
 * Stays node-side because the real `ModAPIImpl` ctor pulls in DOM
 * controllers + audio + Preact runtime; for the registration path
 * only the registry + world.add surface matters.
 *
 * Run:
 *   bun run scripts/smoke-declarative-prefabs.ts
 */

import {
  registerDeclarativePrefabs,
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

// ── Minimal ModAPI stub ─────────────────────────────────────────────
//
// `registerDeclarativePrefabs` only touches:
//   api.registerPrefab(name, factory)
//   api.world.spawn()                 → Entity (number)
//   api.world.add(entity, comp, data) → chainable
//   api.getComponent(name)            → marker Component
//
// And the test invokes:
//   api.spawn(name, opts)             → fires the registered factory
//
// Everything else on the real ModAPI surface is unused by this code
// path, so we elide it.

interface RecordedAdd {
  entity: number;
  componentName: string;
  value: unknown;
}

interface StubComponent {
  __name: string;
}

interface StubAPI {
  world: { spawn: () => number; add: (e: number, c: StubComponent, v: unknown) => StubAPI["world"] };
  registerPrefab: (name: string, factory: (...args: unknown[]) => number) => void;
  spawn: (name: string, ...args: unknown[]) => number;
  getComponent: (name: string) => StubComponent | undefined;
  // What we observe externally for assertions.
  __components: Map<string, StubComponent>;
  __prefabs: Map<string, (...args: unknown[]) => number>;
  __recorded: RecordedAdd[];
}

function makeStubAPI(knownComponents: ReadonlyArray<string>): StubAPI {
  const compMap = new Map<string, StubComponent>();
  for (const n of knownComponents) compMap.set(n, { __name: n });
  const prefabs = new Map<string, (...args: unknown[]) => number>();
  const recorded: RecordedAdd[] = [];
  let nextEntity = 1;

  const api: StubAPI = {
    __components: compMap,
    __prefabs: prefabs,
    __recorded: recorded,
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

// ── Fake manifest ──────────────────────────────────────────────────

function manifestWith(prefabs: Record<string, DeclarativePrefab>): PackManifest {
  return {
    name: "decl-prefab-smoke",
    version: "0.0.1",
    tileTextures: {},
    tileSheets: [],
    startScene: "scenes/none.json",
    prefabs,
  };
}

// ── 1. Happy path — Position + Sprite + Light ──────────────────────

console.log("Test 1 — Position + Sprite + Light register + spawn.");
{
  const api = makeStubAPI(["Position", "Sprite", "Light", "Facing"]);
  const prefab: DeclarativePrefab = {
    name: "test_prefab",
    components: {
      Position: { x: 1, y: 2, z: 0.5 },
      Sprite: { imageId: "torch", scale: 1.5 },
      Light: { color: [1, 0.5, 0.2], intensity: 2, radius: 3, z: 0.5 },
    },
  };

  registerDeclarativePrefabs(
    api as unknown as Parameters<typeof registerDeclarativePrefabs>[0],
    manifestWith({ test_prefab: prefab }),
  );

  assert(api.__prefabs.has("test_prefab"), "test_prefab registered");

  const entity = api.spawn("test_prefab", {});
  const rec = recordedFor(api, entity);
  const byName = Object.fromEntries(
    rec.map((r) => [r.componentName, r.value]),
  );

  // Position is materialized into a `Vec2`-ish carrier (the real engine
  // path returns a Vec2 instance; here `Vec2` is the real engine class).
  // Assert by field readback rather than deep-eq because the carrier
  // may carry method properties.
  const pos = byName.Position as { x: number; y: number; z: number };
  assertEqual(pos.x, 1, "Position.x === 1");
  assertEqual(pos.y, 2, "Position.y === 2");
  assertEqual(pos.z, 0.5, "Position.z === 0.5");

  assertEqual(
    byName.Sprite,
    { imageId: "torch", scale: 1.5 },
    "Sprite data round-trips",
  );
  assertEqual(
    byName.Light,
    { color: [1, 0.5, 0.2], intensity: 2, radius: 3, z: 0.5 },
    "Light data round-trips",
  );

  // ── 2. Spawn-time opts override Position via shorthand ──
  const entity2 = api.spawn("test_prefab", { x: 7, y: 8 });
  const rec2 = recordedFor(api, entity2);
  const pos2 = rec2.find((r) => r.componentName === "Position")!
    .value as { x: number; y: number; z: number };
  assertEqual(pos2.x, 7, "opts.x shorthand overrides Position.x");
  assertEqual(pos2.y, 8, "opts.y shorthand overrides Position.y");
  assertEqual(pos2.z, 0.5, "Position.z preserved when opts.z absent");

  // ── 3. opts.Position object overlay wins over shorthand ──
  const entity3 = api.spawn("test_prefab", {
    Position: { x: 10, y: 11, z: 1.25 },
  });
  const pos3 = recordedFor(api, entity3).find(
    (r) => r.componentName === "Position",
  )!.value as { x: number; y: number; z: number };
  assertEqual(pos3.x, 10, "opts.Position.x wins");
  assertEqual(pos3.y, 11, "opts.Position.y wins");
  assertEqual(pos3.z, 1.25, "opts.Position.z wins");
}

// ── 4. Facing shorthand ────────────────────────────────────────────

console.log("\nTest 2 — opts.facing shorthand rolls into Facing.");
{
  const api = makeStubAPI(["Facing"]);
  registerDeclarativePrefabs(
    api as unknown as Parameters<typeof registerDeclarativePrefabs>[0],
    manifestWith({
      turret: { name: "turret", components: { Facing: 0 } },
    }),
  );
  const e = api.spawn("turret", { facing: 1.57 });
  const facing = recordedFor(api, e).find(
    (r) => r.componentName === "Facing",
  )!.value;
  assertEqual(facing, 1.57, "opts.facing overrides Facing baseline");
}

// ── 5. Unknown component → warning + skip + rest spawns ───────────

console.log("\nTest 3 — unknown component is skipped, others still spawn.");
{
  const api = makeStubAPI(["Position", "Sprite"]);
  // Capture console.warn so we can assert the right message fires.
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
  try {
    registerDeclarativePrefabs(
      api as unknown as Parameters<typeof registerDeclarativePrefabs>[0],
      manifestWith({
        partial: {
          name: "partial",
          components: {
            Position: { x: 0, y: 0 },
            BogusComponent: { foo: 1 },
            Sprite: { imageId: "x" },
          },
        },
      }),
    );
    const e = api.spawn("partial");
    const rec = recordedFor(api, e);
    const names = rec.map((r) => r.componentName).sort();
    assertEqual(
      names,
      ["Position", "Sprite"],
      "unknown component dropped; Position + Sprite still attached",
    );
    assert(
      warnings.some((w) =>
        w.includes('unknown component "BogusComponent"'),
      ),
      "console.warn fired for unknown component",
    );
  } finally {
    console.warn = originalWarn;
  }
}

// ── 6. Manifest without prefabs → no-op ────────────────────────────

console.log("\nTest 4 — manifest without prefabs is a no-op.");
{
  const api = makeStubAPI(["Position"]);
  const mf: PackManifest = {
    name: "no-prefabs",
    version: "0.0.1",
    tileTextures: {},
    tileSheets: [],
    startScene: "scenes/x.json",
  };
  registerDeclarativePrefabs(
    api as unknown as Parameters<typeof registerDeclarativePrefabs>[0],
    mf,
  );
  assertEqual(api.__prefabs.size, 0, "no prefabs registered");
}

// ── 7. Re-registration replaces ────────────────────────────────────

console.log("\nTest 5 — re-registering the same id replaces the factory.");
{
  const api = makeStubAPI(["Position"]);
  registerDeclarativePrefabs(
    api as unknown as Parameters<typeof registerDeclarativePrefabs>[0],
    manifestWith({
      thing: {
        name: "thing",
        components: { Position: { x: 1, y: 2 } },
      },
    }),
  );
  // Second registration with different data — same id.
  registerDeclarativePrefabs(
    api as unknown as Parameters<typeof registerDeclarativePrefabs>[0],
    manifestWith({
      thing: {
        name: "thing",
        components: { Position: { x: 9, y: 9 } },
      },
    }),
  );
  const e = api.spawn("thing");
  const pos = recordedFor(api, e).find(
    (r) => r.componentName === "Position",
  )!.value as { x: number; y: number };
  assertEqual(pos.x, 9, "second registration's Position.x wins");
  assertEqual(pos.y, 9, "second registration's Position.y wins");
}

console.log();
console.log(`Declarative-prefabs smoke test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
