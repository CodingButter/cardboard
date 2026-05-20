/**
 * Pairing protocol types — mirrored from `sidecar/lib/peerTransport.ts`
 * and `sidecar/lib/identityStore.ts` / `deviceTier.ts`.
 *
 * Why mirror instead of import? The sidecar code base is bundled
 * separately (different HTML entry, different SW scope) and pulls
 * runtime side-effects (`peerjs/dist/peerjs.min.js`) that the editor's
 * src/ tree shouldn't transitively depend on for type-only access.
 * Keeping a small shared TYPE shape lets the desktop pairing layer
 * speak the same wire protocol without dragging the sidecar's runtime
 * into the editor bundle. The two definitions are kept in lockstep —
 * if you change one, change the other.
 */

export type DeviceTier = "mobile" | "tablet" | "desktop";

export interface SidecarIdentity {
  /** User-configured display name, e.g. "Workshop Tablet". */
  name: string;
  /** Hex from the curated palette, e.g. "#f59e0b". */
  color: string;
  /** Lucide icon name from the curated set. */
  icon: string;
  /** Tier captured at creation time. */
  tier: DeviceTier;
  /** Epoch ms — last time the wizard saved. */
  updatedAt: number;
}

export type SemanticPanelKind = string;

/**
 * On-the-wire envelope for the sidecar ↔ desktop data channel. Mirror
 * of `WireMessage` in `sidecar/lib/peerTransport.ts`.
 */
export type WireMessage =
  | {
      kind: "hello";
      identity: SidecarIdentity;
      deviceTier: DeviceTier;
      mountedKind?: SemanticPanelKind;
      mountedLayout?: string;
    }
  | { kind: "welcome"; sessionId: string }
  | { kind: "storeWrite"; storeId: string; patch: unknown; origin: string }
  | { kind: "ping" }
  | { kind: "pong" }
  | { kind: "disconnect"; reason?: string };
