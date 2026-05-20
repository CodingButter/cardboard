/**
 * Device-tier detection for the SideCar PWA.
 *
 * Per REMOTE_DOCK_QR.md §5b: each sidecar classifies itself on
 * cold-launch and reports the tier in WebRTC peer-handshake metadata
 * (D10+). The desktop then knows what each paired device can do —
 * full layouts on a tablet/desktop, single-group tab dock on a phone.
 *
 * Heuristic blends viewport width with `navigator.maxTouchPoints` so
 * a touch-capable Surface gets `tablet` while a 1366px laptop gets
 * `desktop`. The phablet branch (`< 900 + touch`) routes 7" tablets
 * with touch into the `mobile` tier, matching the spec.
 *
 * This is intentionally a pure function — exposed for tests / future
 * sidecar Settings ("show me how this device classifies").
 */

export type DeviceTier = "mobile" | "tablet" | "desktop";

export function detectDeviceTier(): DeviceTier {
  if (typeof window === "undefined") return "desktop";
  const w = window.innerWidth;
  const touch = (navigator.maxTouchPoints ?? 0) > 0;
  if (w < 768) return "mobile";
  if (touch && w < 900) return "mobile"; // phablet
  if (touch && w < 1366) return "tablet";
  return "desktop";
}

/**
 * Default icon name (lucide) per tier. Used when the user skips the
 * identity wizard and we mint a placeholder.
 */
export function defaultIconForTier(tier: DeviceTier): string {
  switch (tier) {
    case "mobile":
      return "Smartphone";
    case "tablet":
      return "Tablet";
    case "desktop":
      return "Monitor";
  }
}

/**
 * Default name prefix per tier. Combined with a counter for skip-wizard
 * placeholder identities (e.g. "Tablet #1").
 */
export function defaultNamePrefixForTier(tier: DeviceTier): string {
  switch (tier) {
    case "mobile":
      return "Phone";
    case "tablet":
      return "Tablet";
    case "desktop":
      return "Desktop";
  }
}
