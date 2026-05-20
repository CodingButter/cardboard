/**
 * URL-param parser for the SideCar PWA.
 *
 * The URL contract per REMOTE_DOCK_QR.md §4:
 *
 *   /sidecar/?peer=<id>&kind=<panelKind>&layout=<layoutId>&label=<text>&mode=<mode>
 *
 * - `peer`: PeerJS id of the desktop. Required to enter the "connecting"
 *   state. Absent → cold-launch screen.
 * - `kind` / `layout`: which panel(s) to mount. `layout` wins when both
 *   are present. D9 only displays them in the loading skeleton; D10
 *   wires the actual mount.
 * - `label`: human-friendly header text shown immediately on connect
 *   (zero-latency feedback) before the data channel is open.
 * - `mode`: `dock` | `controller` | `display`. Unset → `dock`.
 *
 * All values are passed through untrusted from the URL — callers should
 * treat them as user input. This module performs minimal whitelisting
 * (no allow-list of kinds yet; D10 wires the actual panel registry).
 */

export type SidecarMode = "dock" | "controller" | "display";

export interface SidecarParams {
  peer: string | null;
  kind: string | null;
  layout: string | null;
  label: string | null;
  mode: SidecarMode;
}

function clampLength(s: string, max = 128): string {
  return s.length > max ? s.slice(0, max) : s;
}

function parseMode(raw: string | null): SidecarMode {
  if (raw === "controller" || raw === "display") return raw;
  return "dock";
}

/**
 * Read sidecar URL params from a search string (defaults to
 * `window.location.search`). Returns null for missing string params,
 * never undefined, so call sites can do strict equality checks.
 */
export function readSidecarParams(search: string = typeof window !== "undefined" ? window.location.search : ""): SidecarParams {
  const sp = new URLSearchParams(search);
  const peer = sp.get("peer");
  const kind = sp.get("kind");
  const layout = sp.get("layout");
  const label = sp.get("label");
  const mode = sp.get("mode");
  return {
    peer: peer ? clampLength(peer) : null,
    kind: kind ? clampLength(kind) : null,
    layout: layout ? clampLength(layout) : null,
    label: label ? clampLength(label, 64) : null,
    mode: parseMode(mode),
  };
}

/**
 * True when the URL designates an in-progress pairing (we have a peer
 * id to dial). False → cold-launch UI should render.
 */
export function hasPairingTarget(p: SidecarParams): boolean {
  return Boolean(p.peer);
}
