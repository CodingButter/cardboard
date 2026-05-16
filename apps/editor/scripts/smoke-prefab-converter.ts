/**
 * Phase #196 (Part B) — `prefabConverter.ts` smoke test.
 *
 * Pure-function regression coverage for the JS → declarative
 * converter. DOM-free; uses Bun-only APIs.
 *
 * Matrix:
 *   1. Happy path — a mixed prefab with three static `world.add` calls
 *      and one `opts.*` dynamic call. Asserts:
 *      - the static calls land in `staticComponents` with the right
 *        component name keys + the right JSON-shaped values
 *      - the dynamic call shows up in the residual `residualBody`
 *      - the result is NOT flagged `tooDynamic`
 *   2. Comment preservation — leading `/** ... *\/` block survives
 *      into the serialised init-script body.
 *   3. Vec2 special case — `new api.Vec2(x, y)` with literal args
 *      converts to `{ x, y }` so the declarative path can spawn the
 *      same shape.
 *   4. Multi-prefab file — two `registerPrefab` calls in one file
 *      each surface as a separate `PrefabConversionResult`.
 *   5. Too-dynamic file — every add references `opts.*`; result is
 *      flagged `tooDynamic: true` with zero extracted components.
 *   6. Init-script emitter — `serializeInitScript` produces a runnable
 *      ESM module with the residual body wrapped in `function init`.
 *
 * Run:
 *   cd apps/editor && bun run scripts/smoke-prefab-converter.ts
 */

import {
  parsePrefabFile,
  prefabInitScriptPath,
  serializeInitScript,
} from "../src/lib/prefabConverter";

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

// ── Test 1: mixed static + dynamic ───────────────────────────────

console.log("Test 1 — mixed static + dynamic prefab.");
{
  const source = `
/**
 * Pretend pack-script for a "zombie" prefab. Most fields are static
 * (manifest material), but Position rolls in opts.x / opts.y so the
 * call site can place the zombie anywhere.
 */
export default (api) => {
  api.registerPrefab("zombie", (opts = {}) => {
    const world = api.world;
    const C = api.components;
    const entity = world.spawn();
    world
      .add(entity, C.Position, new api.Vec2(opts.x ?? 0, opts.y ?? 0))
      .add(entity, C.Sprite, { imageId: "zombie", scale: 1.2 })
      .add(entity, C.Light, { color: [1, 0.4, 0.2], intensity: 1.5, radius: 4 })
      .add(entity, C.MinimapMarker, { color: "#ff0000", radius: 0.1 });
    return entity;
  });
};
`.trim();

  const file = await parsePrefabFile("scripts/prefabs/zombie.js", source);
  assert(!file.parseError, "file parses without error");
  assert(!file.noPrefabsFound, "registerPrefab call discovered");
  assertEqual(file.prefabs.length, 1, "exactly one prefab in this file");

  const r = file.prefabs[0]!;
  assertEqual(r.name, "zombie", "prefab name extracted");

  // The three static calls landed.
  assert(
    "Sprite" in r.staticComponents,
    "Sprite extracted as static component",
  );
  assert(
    "Light" in r.staticComponents,
    "Light extracted as static component",
  );
  assert(
    "MinimapMarker" in r.staticComponents,
    "MinimapMarker extracted as static component",
  );
  assertEqual(
    r.staticComponents.Sprite,
    { imageId: "zombie", scale: 1.2 },
    "Sprite JSON shape matches source",
  );
  assertEqual(
    r.staticComponents.Light,
    { color: [1, 0.4, 0.2], intensity: 1.5, radius: 4 },
    "Light JSON shape matches source",
  );
  assertEqual(
    r.staticComponents.MinimapMarker,
    { color: "#ff0000", radius: 0.1 },
    "MinimapMarker JSON shape matches source",
  );

  // The dynamic Position call lives in the residual.
  assert(
    !("Position" in r.staticComponents),
    "Position NOT extracted because value reads opts",
  );
  assert(
    r.residualBody.includes("opts.x") || r.residualBody.includes("opts.y"),
    "residualBody contains the opts.x / opts.y reference",
  );

  // Not flagged "too dynamic" — three of four extracted.
  assert(!r.tooDynamic, "result is NOT flagged tooDynamic");
  assertEqual(r.extractedCount, 3, "3 of 4 component calls extracted");
  assertEqual(r.totalCalls, 4, "4 total component calls discovered");
}

// ── Test 2: comments survive into the init script ────────────────

console.log("\nTest 2 — file leading comment survives the round-trip.");
{
  const source = `
/**
 * I am a load-bearing doc comment that the converter should preserve.
 * Pack authors rely on these — losing them is the difference between
 * "I converted my prefab" and "where did my notes go?".
 */
export default (api) => {
  api.registerPrefab("commented", (opts) => {
    const world = api.world;
    const C = api.components;
    const e = world.spawn();
    world.add(e, C.Sprite, { imageId: "x", scale: 1 });
    world.add(e, C.Health, { hp: opts.hp });
    return e;
  });
};
`.trim();
  const file = await parsePrefabFile("scripts/prefabs/commented.js", source);
  assert(file.prefabs.length === 1, "1 prefab parsed");
  const r = file.prefabs[0]!;
  assert(
    r.leadingComments.includes("load-bearing doc comment"),
    "leading comments captured in result",
  );

  const emitted = serializeInitScript(r);
  assert(
    emitted.includes("load-bearing doc comment"),
    "leading comments survive serializeInitScript",
  );
  assert(
    emitted.includes("function init(entity, opts, api)"),
    "init script default-export signature emitted",
  );
  assert(
    emitted.includes("opts.hp"),
    "residual opts.hp reference survives into init script",
  );
}

// ── Test 3: Vec2 special case ─────────────────────────────────────

console.log("\nTest 3 — `new api.Vec2(1.5, 2.5)` reduces to `{x:1.5, y:2.5}`.");
{
  const source = `
export default (api) => {
  api.registerPrefab("torch", () => {
    const world = api.world;
    const C = api.components;
    const e = world.spawn();
    world.add(e, C.Position, new api.Vec2(1.5, 2.5));
    return e;
  });
};
`.trim();
  const file = await parsePrefabFile("scripts/prefabs/torch.js", source);
  const r = file.prefabs[0]!;
  assertEqual(
    r.staticComponents.Position,
    { x: 1.5, y: 2.5 },
    "Vec2(1.5, 2.5) extracted as { x, y }",
  );
  assertEqual(r.extractedCount, 1, "Vec2 counts as extracted");
}

// ── Test 4: multi-prefab file ────────────────────────────────────

console.log("\nTest 4 — file with multiple registerPrefab calls.");
{
  const source = `
export default (api) => {
  api.registerPrefab("a", () => {
    const world = api.world;
    const e = world.spawn();
    world.add(e, api.components.Sprite, { imageId: "a", scale: 1 });
    return e;
  });
  api.registerPrefab("b", () => {
    const world = api.world;
    const e = world.spawn();
    world.add(e, api.components.Sprite, { imageId: "b", scale: 2 });
    return e;
  });
};
`.trim();
  const file = await parsePrefabFile("scripts/prefabs/multi.js", source);
  assertEqual(file.prefabs.length, 2, "two prefabs discovered");
  const names = file.prefabs.map((p) => p.name).sort();
  assertEqual(names, ["a", "b"], "prefab ids 'a' and 'b' extracted");
  const a = file.prefabs.find((p) => p.name === "a")!;
  const b = file.prefabs.find((p) => p.name === "b")!;
  assertEqual(
    (a.staticComponents.Sprite as { scale: number }).scale,
    1,
    "prefab 'a' Sprite.scale = 1",
  );
  assertEqual(
    (b.staticComponents.Sprite as { scale: number }).scale,
    2,
    "prefab 'b' Sprite.scale = 2",
  );
}

// ── Test 5: too-dynamic prefab ───────────────────────────────────

console.log("\nTest 5 — too-dynamic file → tooDynamic=true, 0 extracted.");
{
  const source = `
export default (api) => {
  api.registerPrefab("dynamic", (opts) => {
    const world = api.world;
    const C = api.components;
    const e = world.spawn();
    world.add(e, C.Sprite, { imageId: opts.image, scale: opts.scale });
    world.add(e, C.Position, new api.Vec2(opts.x, opts.y));
    return e;
  });
};
`.trim();
  const file = await parsePrefabFile("scripts/prefabs/dynamic.js", source);
  const r = file.prefabs[0]!;
  assertEqual(r.extractedCount, 0, "0 components extractable");
  assert(r.tooDynamic, "result flagged tooDynamic=true");
  assert(
    r.residualBody.includes("opts.image") ||
      r.residualBody.includes("opts.x"),
    "residualBody retains the opts-driven calls",
  );
}

// ── Test 6: init-script emitter format ───────────────────────────

console.log("\nTest 6 — serializeInitScript wraps residual into a default export.");
{
  const source = `
export default (api) => {
  api.registerPrefab("emit", (opts) => {
    const world = api.world;
    const C = api.components;
    const e = world.spawn();
    world.add(e, C.Sprite, { imageId: "emit", scale: 1 });
    world.add(e, C.Health, { hp: opts.hp ?? 100 });
    return e;
  });
};
`.trim();
  const file = await parsePrefabFile("scripts/prefabs/emit.js", source);
  const r = file.prefabs[0]!;
  const initSrc = serializeInitScript(r);
  assert(
    initSrc.startsWith("/**") ||
      initSrc.includes("export default function init"),
    "init script starts with doc / export",
  );
  assert(
    initSrc.includes("export default function init(entity, opts, api)"),
    "default-export signature is `(entity, opts, api)`",
  );
  assert(initSrc.includes("opts.hp"), "residual opts.hp reference present");
  assert(
    !initSrc.includes("imageId: \"emit\""),
    "static Sprite value NOT duplicated into init script",
  );
}

// ── Test 7: prefabInitScriptPath naming convention ───────────────

console.log("\nTest 7 — prefabInitScriptPath canonicalises names.");
{
  assertEqual(
    prefabInitScriptPath("player"),
    "scripts/prefabs/player-init.js",
    "simple name maps to scripts/prefabs/<name>-init.js",
  );
  assertEqual(
    prefabInitScriptPath("Foo Bar/Baz"),
    "scripts/prefabs/Foo-Bar-Baz-init.js",
    "weird chars collapse to dashes",
  );
}

// ── Test 8: noPrefabsFound when file has none ───────────────────

console.log("\nTest 8 — file without registerPrefab is flagged noPrefabsFound.");
{
  const source = `
export default (api) => {
  console.log("just a setup script, no prefab here");
};
`.trim();
  const file = await parsePrefabFile("scripts/random.js", source);
  assert(file.noPrefabsFound, "noPrefabsFound flag set");
  assertEqual(file.prefabs.length, 0, "no prefabs reported");
}

// ── Test 9: -Infinity / NaN reject from static extraction ─────────

console.log(
  "\nTest 9 — non-JSON-safe literals (Infinity / -Infinity / NaN) stay residual.",
);
{
  const source = `
export default (api) => {
  api.registerPrefab("infin", () => {
    const world = api.world;
    const C = api.components;
    const e = world.spawn();
    world.add(e, C.Sentinel, { lastFire: -Infinity, count: 0 });
    return e;
  });
};
`.trim();
  const file = await parsePrefabFile("scripts/prefabs/infin.js", source);
  const r = file.prefabs[0]!;
  assert(
    !("Sentinel" in r.staticComponents),
    "Sentinel rejected because reloadStart is -Infinity",
  );
  assert(
    r.residualBody.includes("Sentinel"),
    "Sentinel call survives in residual body for runtime execution",
  );
}

// ── Test 10: chain de-duplication ────────────────────────────────

console.log(
  "\nTest 10 — long add-chain with mixed extractable / non-extractable links" +
    " emits ONE world.add per non-extractable link, not N copies of the chain.",
);
{
  const source = `
export default (api) => {
  api.registerPrefab("chain", (opts) => {
    const world = api.world;
    const C = api.components;
    const e = world.spawn();
    world
      .add(e, C.Position, new api.Vec2(opts.x, opts.y))
      .add(e, C.Facing, opts.facing)
      .add(e, C.Sprite, { imageId: "x", scale: 1 })
      .add(e, C.Movement, { speed: opts.speed })
      .add(e, C.Health, { hp: opts.hp ?? 100 });
    return e;
  });
};
`.trim();
  const file = await parsePrefabFile("scripts/prefabs/chain.js", source);
  const r = file.prefabs[0]!;
  // Sprite should extract; the others should land in residual once each.
  assert(
    "Sprite" in r.staticComponents,
    "Sprite extracted (only purely-literal link in the chain)",
  );
  // Count occurrences of `world.add(` in the residual — should be 4
  // (Position, Facing, Movement, Health), NOT 16 (4 non-extractable
  // links × 4 copies of the chain, which is what the pre-fix output
  // produced).
  const addCount = (r.residualBody.match(/world\.add\(/g) ?? []).length;
  assertEqual(
    addCount,
    4,
    "residual contains exactly one world.add per non-extractable chain link",
  );
}

// ── Test 11: world/C redundant aliases stripped ──────────────────

console.log(
  "\nTest 11 — `const world = api.world` / `const C = api.components`" +
    " redeclarations stripped from residual (init wrapper provides them).",
);
{
  const source = `
export default (api) => {
  api.registerPrefab("alias", (opts) => {
    const world = api.world;
    const C = api.components;
    const e = world.spawn();
    world.add(e, C.Health, { hp: opts.hp });
    return e;
  });
};
`.trim();
  const file = await parsePrefabFile("scripts/prefabs/alias.js", source);
  const r = file.prefabs[0]!;
  const initSrc = serializeInitScript(r);
  // The wrapper's own `const world = api.world;` line is fine — but
  // the residual must NOT have a SECOND one or module load throws
  // SyntaxError "Identifier 'world' has already been declared".
  const worldDecls = (
    initSrc.match(/const\s+world\s*=\s*api\.world/g) ?? []
  ).length;
  const cDecls = (initSrc.match(/const\s+C\s*=\s*api\.components/g) ?? [])
    .length;
  assertEqual(worldDecls, 1, "exactly one `const world = api.world` in init");
  assertEqual(cDecls, 1, "exactly one `const C = api.components` in init");
}

// ── Test 12: closure-captured const hoisted into init ─────────────

console.log(
  "\nTest 12 — closure-captured top-level consts referenced by the" +
    " factory body hoist into the residual init script.",
);
{
  const source = `
export default (api) => {
  const defaultHealth = () => ({ hp: api.config.player.maxHp });
  api.registerPrefab("hoist", (opts) => {
    const world = api.world;
    const C = api.components;
    const e = world.spawn();
    world.add(e, C.Health, defaultHealth());
    return e;
  });
};
`.trim();
  const file = await parsePrefabFile("scripts/prefabs/hoist.js", source);
  const r = file.prefabs[0]!;
  assert(
    r.residualBody.includes("defaultHealth"),
    "factory references defaultHealth in residual",
  );
  assert(
    r.residualBody.includes("const defaultHealth"),
    "defaultHealth declaration hoisted into residual from outer closure",
  );
}

// ── Test 13: real default-pack player.js fixture ─────────────────

console.log(
  "\nTest 13 — default-pack's actual player.js fixture round-trips cleanly.",
);
{
  // Load the checked-in original. This survives any in-flight
  // migration of `packages/default-pack/scripts/prefabs/player.js` to
  // a declarative-only shape — the fixture stays stable so the
  // converter's regression coverage doesn't shift under us.
  const fixturePath = new URL(
    "./fixtures/player.js.original",
    import.meta.url,
  );
  const fixtureSrc = await Bun.file(fixturePath).text();
  const file = await parsePrefabFile(
    "scripts/prefabs/player.js",
    fixtureSrc,
  );
  assert(!file.parseError, "fixture parses without error");
  assertEqual(file.prefabs.length, 1, "exactly one prefab in player.js");
  const r = file.prefabs[0]!;
  assertEqual(r.name, "player", "prefab name is `player`");
  assertEqual(
    r.totalCalls,
    9,
    "9 world.add chain links discovered (Position/Facing/Movement/" +
      "PlayerInput/Aim/Weapon/Inventory/Camera/MinimapMarker)",
  );
  // At least Aim extracts; nothing else does (every other call reads
  // opts or config). Aim is the only purely-literal one.
  assert(
    "Aim" in r.staticComponents,
    "Aim ({ screenY: 0 }) extracts as static",
  );
  // Weapon must NOT extract — its sentinel `reloadStart: -Infinity`
  // can't roundtrip through JSON.
  assert(
    !("Weapon" in r.staticComponents),
    "Weapon stays in residual because reloadStart is -Infinity",
  );
  // The init script must be well-formed: ONE `const world = api.world`,
  // ONE `const C = api.components`, and the residual contains exactly
  // one world.add per non-extractable call (8 of them).
  const initSrc = serializeInitScript(r);
  const worldDecls = (
    initSrc.match(/const\s+world\s*=\s*api\.world/g) ?? []
  ).length;
  const cDecls = (initSrc.match(/const\s+C\s*=\s*api\.components/g) ?? [])
    .length;
  assertEqual(worldDecls, 1, "one `const world` binding in emitted init");
  assertEqual(cDecls, 1, "one `const C` binding in emitted init");
  // Closure-captured `defaultCamera` hoists in.
  assert(
    initSrc.includes("const defaultCamera"),
    "defaultCamera helper hoisted from outer closure",
  );
  // The init script's residual references opts (x/y/facing
  // destructuring) — proves the dynamic spawn-time deps survive.
  assert(initSrc.includes("opts"), "init script references opts");
}

console.log();
console.log(`Prefab-converter smoke test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
