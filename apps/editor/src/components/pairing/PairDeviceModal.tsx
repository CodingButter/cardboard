import React from "react";
import QRCode from "qrcode";
import * as Lucide from "lucide-react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import {
  initDesktopPeer,
  disconnectPairedPeer,
} from "../../state/desktopPairingSingleton";
import { useDesktopPairingStore } from "../../state/useDesktopPairingStore";
import type { PairedPeerEntry } from "../../state/useDesktopPairingStore";

/**
 * PairDeviceModal — desktop-side hub for the sidecar pairing flow.
 *
 * Shape (post task #16 polish):
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ Pair Device                                              │
 *   │ Connect a phone or tablet to send panels to it.          │
 *   ├──────────────────────────────────────────────────────────┤
 *   │  CONNECTED DEVICES                                       │
 *   │   ┌──────────────────────────────────────────────────┐   │
 *   │   │ [icon]  Workshop Tablet         · connected ●    │   │
 *   │   │ tablet · paired 12s ago        [Disconnect]      │   │
 *   │   └──────────────────────────────────────────────────┘   │
 *   │   …                                                      │
 *   ├──────────────────────────────────────────────────────────┤
 *   │  PAIR A NEW DEVICE                                       │
 *   │   ┌────────── QR ──────────┐   Scan with your phone…    │
 *   │   │                        │   or copy this URL:        │
 *   │   │                        │   [https://… ] [Copy]      │
 *   │   └────────────────────────┘                            │
 *   └──────────────────────────────────────────────────────────┘
 *
 * Connected-device list updates live from `useDesktopPairingStore`.
 * Each row carries an identity chip, a status pill, and a Disconnect
 * button. Recently-ended peers fade out after ~3s rather than
 * persisting (the store keeps them around in case a popped-out window
 * needs to see the last-known identity; the modal hides them on a
 * timer for UX).
 *
 * The QR + URL block is always present — pairing is additive, so
 * "pair another" is a first-class action.
 */

const ENDED_FADEOUT_MS = 3_000;

export interface PairDeviceModalProps {
  open: boolean;
  onClose: () => void;
  /**
   * Optional override for the sidecar URL's `kind` / `label` params.
   * MVP hardcodes `kind=test` + `label=Test Session`; later passes
   * can wire the dock registry into these fields.
   */
  kind?: string;
  label?: string;
}

export function PairDeviceModal({
  open,
  onClose,
  kind = "test",
  label = "Test Session",
}: PairDeviceModalProps) {
  const ownPeerId = useDesktopPairingStore((s) => s.ownPeerId);
  const pairedPeers = useDesktopPairingStore((s) => s.pairedPeers);
  const removePairedPeer = useDesktopPairingStore((s) => s.removePairedPeer);

  // Kick the singleton when the modal opens. Idempotent — repeat
  // calls just return the cached own-id promise.
  React.useEffect(() => {
    if (!open) return;
    void initDesktopPeer().catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[pair-device] failed to initialise peer:", err);
    });
  }, [open]);

  // Fade-out for ended peers. We don't immediately drop them from the
  // store on disconnect (other windows may still want to read the
  // identity); instead the modal grants them a 3s "RIP" cameo, then
  // calls `removePairedPeer` to clear the entry.
  //
  // The seen-time map tracks WHEN we first observed each peer in its
  // current `ended` state. If a peer's status flips away from `ended`
  // (re-pair) we drop the seen entry so a future re-end starts the
  // fade-out clock fresh. If the peer is removed from the store
  // outside this modal, the entry naturally falls out on the next
  // render's reconciliation pass.
  const endedSinceRef = React.useRef<Map<string, number>>(new Map());
  React.useEffect(() => {
    const now = Date.now();
    const seen = endedSinceRef.current;
    // Reconcile: stamp newly-ended peers; clear seen state for any
    // peer that's no longer in `ended` (whether it's been re-paired,
    // removed, or replaced).
    const seenIds = new Set(seen.keys());
    let nextDeadline = Infinity;
    for (const entry of Object.values(pairedPeers)) {
      if (entry.status === "ended") {
        if (!seen.has(entry.id)) seen.set(entry.id, now);
        const deadline = (seen.get(entry.id) ?? now) + ENDED_FADEOUT_MS;
        nextDeadline = Math.min(nextDeadline, deadline);
        seenIds.delete(entry.id);
      } else {
        seen.delete(entry.id);
        seenIds.delete(entry.id);
      }
    }
    // Anything left in seenIds was removed from the store; drop it.
    for (const id of seenIds) seen.delete(id);

    if (nextDeadline === Infinity) return;
    const ms = Math.max(0, nextDeadline - now);
    const t = window.setTimeout(() => {
      const seenNow = endedSinceRef.current;
      const cutoff = Date.now() - ENDED_FADEOUT_MS + 50;
      for (const [id, t0] of seenNow) {
        if (t0 <= cutoff) {
          removePairedPeer(id);
          seenNow.delete(id);
        }
      }
    }, ms);
    return () => window.clearTimeout(t);
  }, [pairedPeers, removePairedPeer]);

  // Partition: live (connecting + connected) above, fading (ended)
  // below until they age out.
  const { livePeers, fadingPeers } = React.useMemo(() => {
    const live: PairedPeerEntry[] = [];
    const fading: PairedPeerEntry[] = [];
    for (const entry of Object.values(pairedPeers)) {
      if (entry.status === "ended") fading.push(entry);
      else live.push(entry);
    }
    live.sort((a, b) => a.connectedAt - b.connectedAt);
    fading.sort((a, b) => b.connectedAt - a.connectedAt);
    return { livePeers: live, fadingPeers: fading };
  }, [pairedPeers]);

  const sidecarUrl = React.useMemo(() => {
    if (!ownPeerId) return null;
    if (typeof window === "undefined") return null;
    const u = new URL("/sidecar/", window.location.origin);
    u.searchParams.set("peer", ownPeerId);
    u.searchParams.set("kind", kind);
    u.searchParams.set("label", label);
    return u.toString();
  }, [ownPeerId, kind, label]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Pair Device"
      description="Connect a phone or tablet to send panels to it."
      width="xl"
      footer={
        <Button variant="secondary" size="md" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="flex flex-col gap-5 py-1">
        {(livePeers.length > 0 || fadingPeers.length > 0) && (
          <ConnectedDevicesSection
            livePeers={livePeers}
            fadingPeers={fadingPeers}
          />
        )}
        <PairNewDeviceSection
          sidecarUrl={sidecarUrl}
          hasExistingPair={livePeers.length > 0}
        />
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Connected-devices list.
// ---------------------------------------------------------------------------

function ConnectedDevicesSection({
  livePeers,
  fadingPeers,
}: {
  livePeers: PairedPeerEntry[];
  fadingPeers: PairedPeerEntry[];
}) {
  return (
    <section className="flex flex-col gap-2" data-testid="connected-devices">
      <SectionLabel>
        <Lucide.Smartphone size={11} className="text-zinc-400" />
        Paired Devices ({livePeers.length})
      </SectionLabel>
      <div className="flex flex-col gap-1.5">
        {livePeers.map((entry) => (
          <DeviceRow key={entry.id} entry={entry} fading={false} />
        ))}
        {fadingPeers.map((entry) => (
          <DeviceRow key={entry.id} entry={entry} fading={true} />
        ))}
      </div>
    </section>
  );
}

function DeviceRow({
  entry,
  fading,
}: {
  entry: PairedPeerEntry;
  fading: boolean;
}) {
  const identity = entry.identity;
  const color = identity?.color ?? "#3b82f6";
  const iconName = identity?.icon ?? "Smartphone";
  const tier = entry.deviceTier ?? "device";
  const status = entry.status;

  const ago = useTimeAgo(entry.connectedAt);

  return (
    <div
      data-peer-id={entry.id}
      data-fading={fading ? "true" : undefined}
      className={[
        "flex items-center gap-3 p-3 rounded-md border",
        "transition-opacity duration-500",
        fading ? "opacity-30 pointer-events-none" : "opacity-100",
      ].join(" ")}
      style={{
        borderColor: `${color}33`,
        backgroundColor: `${color}0d`,
      }}
    >
      <div
        className="flex items-center justify-center w-10 h-10 rounded-md shrink-0"
        style={{
          borderColor: `${color}66`,
          backgroundColor: `${color}1f`,
          borderWidth: 1,
          borderStyle: "solid",
          color,
        }}
      >
        <LucideByName name={iconName} className="w-5 h-5" color={color} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-zinc-100 truncate">
          {identity?.name ?? "Unknown device"}
        </div>
        <div className="text-[11px] text-zinc-500 capitalize truncate">
          {tier}
          {status === "connected" && ago ? ` · paired ${ago}` : ""}
        </div>
      </div>

      <StatusPill status={status} />

      {status !== "ended" && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => disconnectPairedPeer(entry.id)}
          leadingIcon={<Lucide.PlugZap size={12} />}
          className="border-red-500/40 text-red-300 hover:bg-red-500/10 shrink-0"
        >
          Disconnect
        </Button>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: PairedPeerEntry["status"] }) {
  const meta = {
    connecting: {
      label: "Connecting",
      classes:
        "bg-amber-500/10 border-amber-500/30 text-amber-300",
      dot: "bg-amber-400 animate-pulse",
    },
    connected: {
      label: "Connected",
      classes:
        "bg-emerald-500/10 border-emerald-500/30 text-emerald-300",
      dot: "bg-emerald-400",
    },
    ended: {
      label: "Disconnected",
      classes: "bg-zinc-700/40 border-zinc-700 text-zinc-400",
      dot: "bg-zinc-500",
    },
  }[status];
  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border",
        "text-[10px] font-medium uppercase tracking-wide shrink-0",
        meta.classes,
      ].join(" ")}
    >
      <span
        className={`inline-block w-1.5 h-1.5 rounded-full ${meta.dot}`}
      />
      {meta.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Pair-new-device section (QR + URL).
// ---------------------------------------------------------------------------

function PairNewDeviceSection({
  sidecarUrl,
  hasExistingPair,
}: {
  sidecarUrl: string | null;
  hasExistingPair: boolean;
}) {
  const [dataUrl, setDataUrl] = React.useState<string | null>(null);
  const [qrError, setQrError] = React.useState<string | null>(null);
  const [copyStatus, setCopyStatus] = React.useState<"idle" | "copied">("idle");

  React.useEffect(() => {
    if (!sidecarUrl) {
      setDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(sidecarUrl, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 240,
      color: {
        dark: "#000000ff",
        light: "#ffffffff",
      },
    })
      .then((url) => {
        if (cancelled) return;
        setDataUrl(url);
        setQrError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setDataUrl(null);
        setQrError(
          err instanceof Error
            ? err.message
            : "Failed to render the QR code.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [sidecarUrl]);

  const handleCopy = React.useCallback(async () => {
    if (!sidecarUrl) return;
    try {
      await navigator.clipboard.writeText(sidecarUrl);
      setCopyStatus("copied");
      setTimeout(() => setCopyStatus("idle"), 1500);
    } catch {
      /* fall through — URL is still selectable in the input */
    }
  }, [sidecarUrl]);

  return (
    <section className="flex flex-col gap-3">
      <SectionLabel>
        <Lucide.QrCode size={11} className="text-zinc-400" />
        {hasExistingPair ? "Pair Another Device" : "Pair a New Device"}
      </SectionLabel>

      <div className="flex items-start gap-4">
        <div
          className="flex items-center justify-center w-[240px] h-[240px] rounded-md bg-white border border-zinc-800 shrink-0"
          aria-live="polite"
        >
          {dataUrl ? (
            <img
              src={dataUrl}
              alt="Pairing QR code"
              width={240}
              height={240}
              className="w-[240px] h-[240px]"
              draggable={false}
            />
          ) : qrError ? (
            <span className="text-xs text-red-500 px-4 text-center">
              {qrError}
            </span>
          ) : (
            <Lucide.Loader2 className="w-7 h-7 text-zinc-400 animate-spin" />
          )}
        </div>

        <div className="flex-1 min-w-0 flex flex-col gap-3">
          <p className="text-xs text-zinc-400 leading-relaxed">
            Scan this QR with the SideCar PWA on your phone or tablet —
            or open this URL directly on the device:
          </p>
          <div className="flex flex-col gap-2">
            <input
              type="text"
              readOnly
              value={sidecarUrl ?? "Initialising…"}
              className="w-full h-9 px-3 text-xs font-mono text-zinc-200 bg-zinc-900 border border-zinc-800 rounded-md select-all"
              onFocus={(e) => e.target.select()}
              aria-label="Sidecar pairing URL"
            />
            <Button
              variant="secondary"
              size="md"
              onClick={handleCopy}
              disabled={!sidecarUrl}
              leadingIcon={
                copyStatus === "copied" ? (
                  <Lucide.Check size={12} />
                ) : (
                  <Lucide.Copy size={12} />
                )
              }
              className="h-9 self-start"
            >
              {copyStatus === "copied" ? "Copied" : "Copy URL"}
            </Button>
          </div>
          <p className="text-[11px] text-zinc-500 leading-relaxed">
            New devices join your session live — already-paired devices
            keep their connection.
          </p>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Misc presentational helpers.
// ---------------------------------------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-zinc-500 font-semibold">
      {children}
    </div>
  );
}

/**
 * Returns a tiny relative-time string for `t` (epoch ms) that updates
 * every 10s. Used by the connected-device row to show "paired 12s ago"
 * without growing a heavyweight time-ago library.
 */
function useTimeAgo(t: number): string {
  const [, force] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    const id = window.setInterval(force, 10_000);
    return () => window.clearInterval(id);
  }, []);
  const ms = Date.now() - t;
  if (ms < 0) return "just now";
  if (ms < 30_000) return "just now";
  if (ms < 60_000) return `${Math.round(ms / 1_000)}s ago`;
  if (ms < 60 * 60 * 1_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 24 * 60 * 60 * 1_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

/**
 * Render a lucide icon by name. Mirrors the helper in
 * `sidecar/components/IdentityWizard.tsx` so the desktop renders the
 * sidecar's chosen icon faithfully. Falls back to `Smartphone` on
 * unknown names (better than `Square` for a device-list context).
 */
function LucideByName({
  name,
  className,
  color,
}: {
  name: string;
  className?: string;
  color?: string;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Icon = (Lucide as Record<string, any>)[name] as
    | React.ComponentType<{
        className?: string;
        size?: number;
        color?: string;
      }>
    | undefined;
  if (!Icon) {
    return <Lucide.Smartphone className={className} color={color} />;
  }
  return <Icon className={className} color={color} />;
}
