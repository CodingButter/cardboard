/// <reference types="bun" />
/**
 * Procedural scene generator — emits a "big map" scene JSON for
 * stress-testing the renderer. Rooms-and-corridors layout:
 *
 *   1. Start with all walls.
 *   2. Carve N randomly-placed rectangular rooms.
 *   3. Connect each room to the next with an L-shaped corridor (the
 *      "drunkard's walk" naive variant — good enough that everything
 *      ends up reachable).
 *   4. Pick the first room's center as the player spawn.
 *
 * Determinism: the RNG is seeded so running the script twice gives
 * the same map. Change `SEED` (or pass `--seed N`) to regenerate.
 *
 * Usage:
 *   bun scripts/generate-scene.ts             # default: 64×64, seed 1
 *   bun scripts/generate-scene.ts --w 96 --h 96 --rooms 18 --seed 42
 */

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i]?.replace(/^--/, "") ?? "";
  const val = process.argv[i + 1] ?? "";
  if (key) args.set(key, val);
}

const W = Number(args.get("w") ?? 64);
const H = Number(args.get("h") ?? 64);
const ROOM_COUNT = Number(args.get("rooms") ?? 14);
const SEED = Number(args.get("seed") ?? 1);

// Default output path is repo-root-relative so the script behaves the
// same whether invoked via `bun run generate-scene` (cwd = root) or
// `bun --cwd apps/pack-builder run generate-scene` (cwd = the app).
const REPO_ROOT = new URL("../../../", import.meta.url).pathname;
const OUT_REL = args.get("out") ?? "packages/default-pack/scenes/scene1.json";
const OUT = OUT_REL.startsWith("/") ? OUT_REL : `${REPO_ROOT}${OUT_REL}`;

/** Mulberry32 — fast deterministic PRNG keyed by an integer seed. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(SEED);
const randInt = (lo: number, hi: number): number => lo + Math.floor(rand() * (hi - lo));

/* --- Grid setup ----------------------------------------------------- */

const walls: number[][] = Array.from({ length: H }, () => Array(W).fill(1));

interface Room { x: number; y: number; w: number; h: number; }
const rooms: Room[] = [];

function carveRect(x: number, y: number, w: number, h: number): void {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const ix = x + dx;
      const iy = y + dy;
      if (ix > 0 && ix < W - 1 && iy > 0 && iy < H - 1) {
        walls[iy]![ix] = 0;
      }
    }
  }
}

/* --- Rooms ---------------------------------------------------------- */

for (let i = 0; i < ROOM_COUNT; i++) {
  const w = randInt(4, 12);
  const h = randInt(4, 12);
  const x = randInt(2, W - w - 2);
  const y = randInt(2, H - h - 2);
  rooms.push({ x, y, w, h });
  carveRect(x, y, w, h);
}

/* --- Corridors ------------------------------------------------------ */

function carveCorridor(ax: number, ay: number, bx: number, by: number): void {
  // L-shaped: horizontal then vertical (or vice versa, coin-flip per pair).
  if (rand() < 0.5) {
    const minx = Math.min(ax, bx);
    const maxx = Math.max(ax, bx);
    for (let x = minx; x <= maxx; x++) walls[ay]![x] = 0;
    const miny = Math.min(ay, by);
    const maxy = Math.max(ay, by);
    for (let y = miny; y <= maxy; y++) walls[y]![bx] = 0;
  } else {
    const miny = Math.min(ay, by);
    const maxy = Math.max(ay, by);
    for (let y = miny; y <= maxy; y++) walls[y]![ax] = 0;
    const minx = Math.min(ax, bx);
    const maxx = Math.max(ax, bx);
    for (let x = minx; x <= maxx; x++) walls[by]![x] = 0;
  }
}

for (let i = 0; i < rooms.length - 1; i++) {
  const a = rooms[i]!;
  const b = rooms[i + 1]!;
  const ax = a.x + Math.floor(a.w / 2);
  const ay = a.y + Math.floor(a.h / 2);
  const bx = b.x + Math.floor(b.w / 2);
  const by = b.y + Math.floor(b.h / 2);
  carveCorridor(ax, ay, bx, by);
}

/* --- Pillars (cosmetic) --------------------------------------------- */

// Drop a handful of single-cell pillars inside large rooms for visual
// interest and to give the wall pass something to occlude sprites with.
for (const room of rooms) {
  if (room.w < 6 || room.h < 6) continue;
  const pillars = randInt(0, 3);
  for (let k = 0; k < pillars; k++) {
    const px = room.x + 1 + randInt(0, room.w - 2);
    const py = room.y + 1 + randInt(0, room.h - 2);
    walls[py]![px] = 1;
  }
}

/* --- Floors + ceilings --------------------------------------------- */

// Floor/ceiling layers — every cell uses the layer default (blank
// 9-char strings, matching the existing SceneJSON format).
const floors = walls.map((row) => row.map(() => "         "));
const ceilings = walls.map((row) => row.map(() => "         "));

/* --- Spawn ---------------------------------------------------------- */

const first = rooms[0]!;
const spawn = {
  x: first.x + first.w / 2,
  y: first.y + first.h / 2,
  facing: 0,
};

/* --- Write ---------------------------------------------------------- */

const scene = { spawn, walls, floors, ceilings };
await Bun.write(OUT, JSON.stringify(scene, null, 2) + "\n");

const openCells = walls.reduce((n, row) => n + row.filter((c) => c === 0).length, 0);
console.log(
  `Wrote ${OUT}: ${W}×${H}, ${rooms.length} rooms, ` +
    `${openCells} open cells, spawn (${spawn.x.toFixed(1)}, ${spawn.y.toFixed(1)})`,
);

export {};
