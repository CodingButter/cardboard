import { describe, expect, test } from "bun:test";

import {
  autoNamePreset,
  clonePreset,
  divergedFields,
  hasDiverged,
  type ResolvedPreset,
} from "./presetCrud";

/** Factory: fully-populated preset for test cases. */
function makePreset(overrides: Partial<ResolvedPreset> = {}): ResolvedPreset {
  return {
    id: "wall_brick_red",
    sourcePackId: "test-pack",
    sourcePath: "presets/walls.jsonc",
    data: {
      texture: "tex/wall_brick_red.png",
      topCap: "tex/cap_top.png",
      bottomCap: "tex/cap_bot.png",
      offsetX: 0,
      offsetY: 0,
      wallHeight: 1,
      wallStartZ: 0,
      partialWall: undefined,
      floorHeight: 0,
      ceilingHeight: 1,
      reflectiveness: 0.25,
      transition: 0,
      riserTexture: "tex/riser.png",
      emissive: { color: [1, 0.5, 0.2], intensity: 2, areaLight: true },
      collision: "solid",
      ambientOcclusion: true,
      displayName: "Wall Brick Red",
      tags: ["wall", "brick"],
      thumbnail: undefined,
      shader: undefined,
    },
    ...overrides,
  };
}

describe("clonePreset", () => {
  test("preserves every field except id (and displayName, which tracks id)", () => {
    const src = makePreset();
    const cloned = clonePreset(src, "wall_brick_red_2");

    expect(cloned.id).toBe("wall_brick_red_2");
    expect(cloned.sourcePackId).toBe(src.sourcePackId);
    expect(cloned.sourcePath).toBe(src.sourcePath);

    // Everything in `data` except displayName should be a structural
    // copy of the source. displayName retracks to the new id.
    expect(cloned.data.texture).toBe(src.data.texture);
    expect(cloned.data.topCap).toBe(src.data.topCap);
    expect(cloned.data.bottomCap).toBe(src.data.bottomCap);
    expect(cloned.data.reflectiveness).toBe(src.data.reflectiveness);
    expect(cloned.data.collision).toBe(src.data.collision);
    expect(cloned.data.emissive).toEqual(src.data.emissive);
    expect(cloned.data.tags).toEqual(src.data.tags);
    expect(cloned.data.displayName).toBe("wall_brick_red_2");
  });

  test("performs a deep clone — mutating the clone never reaches the source", () => {
    const src = makePreset();
    const cloned = clonePreset(src, "wall_brick_red_2");

    // Mutate nested + array members of the clone.
    cloned.data.emissive!.color[0] = 0.9;
    (cloned.data.tags as string[]).push("extra");

    expect(src.data.emissive!.color[0]).toBe(1);
    expect(src.data.tags).toEqual(["wall", "brick"]);
  });

  test("leaves displayName undefined if the source didn't have one", () => {
    const src = makePreset({
      data: { ...makePreset().data, displayName: undefined },
    });
    const cloned = clonePreset(src, "fresh_id");
    expect(cloned.data.displayName).toBeUndefined();
  });
});

describe("autoNamePreset", () => {
  const HEX6 = /^[0-9a-f]{6}$/;

  test("produces `{parentId}.{6-char-hex}` for an empty existingIds", () => {
    const id = autoNamePreset("brick.wall", []);
    const dot = id.lastIndexOf(".");
    expect(id.slice(0, dot)).toBe("brick.wall");
    expect(id.slice(dot + 1)).toMatch(HEX6);
  });

  test("does not collide with any id in existingIds (smoke — 50 trials)", () => {
    // The function should never return an id that's already taken. Run it
    // many times to make a regression on the collision check obvious.
    const taken = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const id = autoNamePreset("brick.wall", Array.from(taken));
      expect(taken.has(id)).toBe(false);
      taken.add(id);
    }
  });

  test("keeps the parent id verbatim — including trailing _<digits>", () => {
    // The new naming scheme uses a random suffix for uniqueness, so we
    // no longer strip a numeric family marker off the parent. "foo_42"
    // becomes the base; the hex carries collision avoidance.
    const id = autoNamePreset("foo_42", []);
    expect(id.startsWith("foo_42.")).toBe(true);
    expect(id.slice("foo_42.".length)).toMatch(HEX6);
  });

  test("two consecutive calls with empty existingIds produce different ids", () => {
    // Random suffixes — astronomically unlikely to repeat. If this ever
    // fails it's a real bug (e.g. crypto.getRandomValues stuck).
    const a = autoNamePreset("brick.wall", []);
    const b = autoNamePreset("brick.wall", []);
    expect(a).not.toBe(b);
  });

  test("works with dot-segmented parent ids (the new convention)", () => {
    const id = autoNamePreset("wall.short.glow.pink", []);
    expect(id.startsWith("wall.short.glow.pink.")).toBe(true);
    const suffix = id.slice("wall.short.glow.pink.".length);
    expect(suffix).toMatch(HEX6);
  });

  test("falls back to sequential _N when every random attempt collides", () => {
    // Stub crypto.getRandomValues + Math.random to always yield the same
    // bytes — every randomHex6() call returns "000000". With "foo.000000"
    // already in existingIds, all 10 retries collide and the function
    // must fall back to "foo_2".
    const realCrypto = globalThis.crypto;
    const realRandom = Math.random;
    try {
      // @ts-expect-error — overriding read-only global for test.
      globalThis.crypto = {
        getRandomValues<T extends ArrayBufferView>(buf: T): T {
          const view = buf as unknown as Uint8Array;
          view.fill(0);
          return buf;
        },
      };
      Math.random = () => 0;
      const id = autoNamePreset("foo", ["foo.000000"]);
      expect(id).toBe("foo_2");
    } finally {
      globalThis.crypto = realCrypto;
      Math.random = realRandom;
    }
  });
});

describe("hasDiverged", () => {
  test("returns false for an identical config", () => {
    const preset = makePreset();
    // Mirror every editable field's value back into cellConfig.
    const cellConfig = {
      texture: preset.data.texture,
      topCap: preset.data.topCap,
      bottomCap: preset.data.bottomCap,
      wallHeight: preset.data.wallHeight,
      wallStartZ: preset.data.wallStartZ,
      partialWall: preset.data.partialWall,
      floorHeight: preset.data.floorHeight,
      ceilingHeight: preset.data.ceilingHeight,
      reflectiveness: preset.data.reflectiveness,
      transition: preset.data.transition,
      riserTexture: preset.data.riserTexture,
      emissive: structuredClone(preset.data.emissive),
      tags: structuredClone(preset.data.tags) as string[],
      collision: preset.data.collision,
    };
    expect(hasDiverged(cellConfig, preset)).toBe(false);
  });

  test("returns false for an empty cell config (everything inherited)", () => {
    const preset = makePreset();
    expect(hasDiverged({}, preset)).toBe(false);
  });

  test("returns true when a single primitive field differs", () => {
    const preset = makePreset();
    expect(hasDiverged({ wallHeight: 2 }, preset)).toBe(true);
  });

  test("returns true when a nested emissive sub-field differs", () => {
    const preset = makePreset();
    expect(
      hasDiverged(
        { emissive: { color: [1, 0.5, 0.2], intensity: 5, areaLight: true } },
        preset,
      ),
    ).toBe(true);
  });

  test("returns true when a nested emissive color element differs", () => {
    const preset = makePreset();
    expect(
      hasDiverged(
        { emissive: { color: [0.9, 0.5, 0.2], intensity: 2, areaLight: true } },
        preset,
      ),
    ).toBe(true);
  });

  test("returns true when tags array contents differ", () => {
    const preset = makePreset();
    expect(hasDiverged({ tags: ["wall"] }, preset)).toBe(true);
  });

  test("returns false when tags array matches by value (not reference)", () => {
    const preset = makePreset();
    expect(hasDiverged({ tags: ["wall", "brick"] }, preset)).toBe(false);
  });

  test("returns true when collision class differs", () => {
    const preset = makePreset();
    expect(hasDiverged({ collision: "passable" }, preset)).toBe(true);
  });
});

describe("divergedFields", () => {
  test("returns an empty array when nothing diverges", () => {
    expect(divergedFields({}, makePreset())).toEqual([]);
  });

  test("lists exactly the fields that diverge", () => {
    const preset = makePreset();
    const result = divergedFields(
      {
        // Diverges:
        texture: "tex/different.png",
        emissive: { color: [0, 1, 0], intensity: 1, areaLight: true },
        // Matches the preset → should NOT show up:
        wallHeight: preset.data.wallHeight,
        // Undefined → inherit → should NOT show up:
        collision: undefined,
      },
      preset,
    );
    expect(result).toEqual(["texture", "emissive"]);
  });

  test("preserves the canonical editable-field order", () => {
    const preset = makePreset();
    const result = divergedFields(
      {
        // Insertion order on the input doesn't matter — output is by
        // the EDITABLE_FIELDS canonical order, which puts texture before
        // wallHeight before collision.
        collision: "passable",
        wallHeight: 4,
        texture: "tex/different.png",
      },
      preset,
    );
    expect(result).toEqual(["texture", "wallHeight", "collision"]);
  });
});
