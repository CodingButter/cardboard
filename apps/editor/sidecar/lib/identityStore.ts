import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import {
  defaultIconForTier,
  defaultNamePrefixForTier,
  detectDeviceTier,
  type DeviceTier,
} from "./deviceTier";

/**
 * Sidecar device-identity store.
 *
 * Per REMOTE_DOCK_QR.md §5b: each sidecar carries a user-configured
 * identity (name + color + icon) so multiple devices of the same tier
 * are visually distinguishable. The identity lives on the DEVICE, not
 * the desktop — when the same iPad pairs with your home Mac, your
 * work laptop, or a friend's PC, it announces the same name + color +
 * icon every time. Travels with the hardware, not the host.
 *
 * Storage: separate IDB DB (`cardboard_sidecar`) so it doesn't collide
 * with the editor's project DB. One object store, single row keyed
 * `sidecar.identity` — the row shape matches `SidecarIdentity` in the
 * plan (§5b). Counters for skip-wizard placeholder names live in a
 * separate row.
 *
 * D9 ships the wizard + skip flow + IDB persistence. D10 wires the
 * identity into the WebRTC handshake payload.
 */

const DB_NAME = "cardboard_sidecar";
const DB_VERSION = 1;
const STORE = "kv";

/** Identity record shape — matches `SidecarIdentity` in REMOTE_DOCK_QR.md §5b. */
export interface SidecarIdentity {
  /** User-configured display name, e.g. "Workshop Tablet". */
  name: string;
  /** Hex from the curated palette, e.g. "#f59e0b". */
  color: string;
  /** Lucide icon name from the curated set. */
  icon: string;
  /** Tier captured at creation time (re-detected on each launch too). */
  tier: DeviceTier;
  /** Epoch ms — last time the wizard saved. */
  updatedAt: number;
}

interface SidecarDB extends DBSchema {
  [STORE]: {
    key: string;
    value: unknown;
  };
}

const IDENTITY_KEY = "sidecar.identity";
const COUNTER_KEY = "sidecar.identity.counter";

let dbPromise: Promise<IDBPDatabase<SidecarDB>> | null = null;

function getDB(): Promise<IDBPDatabase<SidecarDB>> {
  if (!dbPromise) {
    dbPromise = openDB<SidecarDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      },
    });
  }
  return dbPromise;
}

/**
 * Load the saved identity, or null if the wizard hasn't been
 * completed (and skip-defaults haven't been minted yet either).
 */
export async function loadIdentity(): Promise<SidecarIdentity | null> {
  try {
    const db = await getDB();
    const row = (await db.get(STORE, IDENTITY_KEY)) as SidecarIdentity | undefined;
    return row ?? null;
  } catch (err) {
    console.warn("[sidecar] loadIdentity failed:", err);
    return null;
  }
}

/** Persist an identity (overwrite). */
export async function saveIdentity(identity: SidecarIdentity): Promise<void> {
  const db = await getDB();
  await db.put(STORE, identity, IDENTITY_KEY);
}

/** Drop the stored identity — used by Settings → "Reset device". */
export async function clearIdentity(): Promise<void> {
  const db = await getDB();
  await db.delete(STORE, IDENTITY_KEY);
}

/**
 * Read-and-increment the skip-wizard counter so consecutive "Skip" presses
 * mint "Tablet #1", "Tablet #2", … instead of all reading "Tablet #1".
 */
async function bumpCounter(): Promise<number> {
  const db = await getDB();
  const current = ((await db.get(STORE, COUNTER_KEY)) as number | undefined) ?? 0;
  const next = current + 1;
  await db.put(STORE, next, COUNTER_KEY);
  return next;
}

/**
 * Curated colour palette — 12 swatches across the hue wheel. Picked
 * for visual distinguishability under both light and dark sidecars;
 * the wizard renders these as circular swatches. The palette is
 * mirrored on the desktop side (Remote Dock Controller chips) so a
 * sidecar paired with `#f59e0b` reads the same orange everywhere.
 */
export const IDENTITY_PALETTE: ReadonlyArray<string> = [
  "#ef4444", // red
  "#f59e0b", // amber
  "#facc15", // yellow
  "#84cc16", // lime
  "#22c55e", // green
  "#14b8a6", // teal
  "#0ea5e9", // sky
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#d946ef", // fuchsia
  "#ec4899", // pink
  "#f97316", // orange
];

/**
 * Curated icon set. Two groups per REMOTE_DOCK_QR.md §5b:
 *   - Device-type icons: Tablet, Smartphone, Monitor, Laptop, Gamepad2, PenTool.
 *   - Abstract markers: Star, Heart, Flame, Zap, Leaf, Diamond, Crown, Anchor, Compass.
 *
 * Names are lucide-react component names so the UI can dynamically
 * look them up. The plan calls out "Bolt"; lucide ships that glyph as
 * `Zap`, so we mirror to the actual export name.
 */
export const DEVICE_TYPE_ICONS: ReadonlyArray<string> = [
  "Tablet",
  "Smartphone",
  "Monitor",
  "Laptop",
  "Gamepad2",
  "PenTool",
];

export const ABSTRACT_ICONS: ReadonlyArray<string> = [
  "Star",
  "Heart",
  "Flame",
  "Zap",
  "Leaf",
  "Diamond",
  "Crown",
  "Anchor",
  "Compass",
];

export const ALL_ICONS: ReadonlyArray<string> = [
  ...DEVICE_TYPE_ICONS,
  ...ABSTRACT_ICONS,
];

/**
 * Create a placeholder identity for users who skip the wizard. Picks a
 * random palette colour, the tier-default icon, and a counter-suffixed
 * name (`Tablet #1`, `Phone #2`, …). The result is persisted.
 */
export async function createDefaultIdentity(
  tierOverride?: DeviceTier,
): Promise<SidecarIdentity> {
  const tier = tierOverride ?? detectDeviceTier();
  const n = await bumpCounter();
  const color =
    IDENTITY_PALETTE[Math.floor(Math.random() * IDENTITY_PALETTE.length)] ??
    "#f59e0b";
  const identity: SidecarIdentity = {
    name: `${defaultNamePrefixForTier(tier)} #${n}`,
    color,
    icon: defaultIconForTier(tier),
    tier,
    updatedAt: Date.now(),
  };
  await saveIdentity(identity);
  return identity;
}
