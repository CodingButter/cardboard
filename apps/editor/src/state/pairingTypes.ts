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
  /**
   * Desktop → sidecar: "mount this panel on your surface."
   *
   * Fired when the user drags a dock panel tab onto a paired-device
   * chip on the desktop. The sidecar interprets the `panelKind` against
   * its own registry. For multi-pane sidecars (`tablet` / `desktop`
   * tier) an optional `hint` lets the desktop suggest layout
   * placement; mobile sidecars ignore the hint and always tab-stack.
   *
   * `state` is a reserved best-effort snapshot for D11b's initial-state
   * mirror — sidecars without that wiring should ignore it for now.
   *
   * Forward-compat: sidecars that don't recognise this kind MUST
   * ignore it (the dispatch switch has a default-noop branch).
   */
  | {
      kind: "mountPanel";
      panelKind: SemanticPanelKind;
      label: string;
      asTab?: boolean;
      hint?: "left" | "right" | "bottom";
      state?: unknown;
    }
  /**
   * Sidecar → desktop: "I dismissed the mounted panel."
   *
   * Mirror of `unmountPanel` in `sidecar/lib/peerTransport.ts`. The
   * desktop receives this when the user taps the sidecar's back button
   * on a mounted panel; the chip's mounted-indicator clears in
   * response. The `panelKind` field echoes back whatever was mounted so
   * the desktop can verify it's clearing the right slot. M2 only
   * carries the active singleton; multi-pane wiring comes later with
   * the tablet-tier work.
   */
  | {
      kind: "unmountPanel";
      panelKind: SemanticPanelKind;
      reason?: "user" | "error";
    }
  | { kind: "disconnect"; reason?: string };
