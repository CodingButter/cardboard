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
 * PairDeviceModal — completes the desktop side of D10.
 *
 * Lifecycle (modal viewpoint):
 *   1. On open, call `initDesktopPeer()` (idempotent — repeat opens just
 *      resolve the cached own-id Promise).
 *   2. Once we have an own-id, compute the sidecar URL and render a QR
 *      code from it. The URL is also displayed as fallback copy-paste
 *      text.
 *   3. The store subscribes to incoming connections (the singleton
 *      writes paired-peer entries as `connecting` → `connected`).
 *      When the FIRST entry flips to `connected`, the modal swaps from
 *      the "waiting" body to the "connected" body showing the device
 *      identity.
 *   4. ESC / backdrop / Close button dismiss the modal but DO NOT
 *      destroy the peer — the connection lives on for the session.
 *      A separate "Disconnect" button on the connected body sends a
 *      `disconnect` over the wire and removes the paired-peer entry.
 *
 * D10b is the MVP — only the modal-via-button entry point. D11+ adds
 * the drag-target QR icon in the sidebar (task #16) and the full
 * store-sync over the wire. For now the modal proves the handshake
 * works.
 */

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

  // Kick the singleton when the modal opens. The singleton itself is
  // idempotent — repeat calls just return the cached own-id promise.
  React.useEffect(() => {
    if (!open) return;
    void initDesktopPeer().catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[pair-device] failed to initialise peer:", err);
    });
  }, [open]);

  // Pick the most recently connected paired peer that's still
  // `connected`. The connected body keys off this. If the user opens
  // the modal AGAIN after having already paired this session, we
  // immediately show the connected body for that prior peer rather
  // than re-displaying the QR.
  const latestConnected: PairedPeerEntry | null = React.useMemo(() => {
    let best: PairedPeerEntry | null = null;
    for (const entry of Object.values(pairedPeers)) {
      if (entry.status !== "connected") continue;
      if (!best || entry.connectedAt > best.connectedAt) {
        best = entry;
      }
    }
    return best;
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
      width="lg"
      footer={
        <Button variant="secondary" size="md" onClick={onClose}>
          Close
        </Button>
      }
    >
      {latestConnected ? (
        <ConnectedBody
          entry={latestConnected}
          onDisconnect={() => disconnectPairedPeer(latestConnected.id)}
        />
      ) : (
        <WaitingBody sidecarUrl={sidecarUrl} />
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// WaitingBody — QR + URL fallback, shown until a peer connects.
// ---------------------------------------------------------------------------

function WaitingBody({ sidecarUrl }: { sidecarUrl: string | null }) {
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
      width: 320,
      color: {
        // Black-on-white renders crisp from a phone camera even on
        // the dark editor theme — keep the QR strictly monochrome.
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
      // Clipboard write can throw (insecure context, denied
      // permission). Surface the URL anyway — the user can select &
      // copy manually.
    }
  }, [sidecarUrl]);

  return (
    <div className="flex flex-col items-center gap-5 py-2">
      <div className="text-center text-sm text-zinc-300 max-w-md">
        Scan this code with your phone or tablet to pair the device with
        this editor. Once connected you can send panels to it.
      </div>

      <div
        className="flex items-center justify-center w-[320px] h-[320px] rounded-lg bg-white border border-zinc-800 shrink-0"
        aria-live="polite"
      >
        {dataUrl ? (
          <img
            src={dataUrl}
            alt="Pairing QR code"
            width={320}
            height={320}
            className="w-[320px] h-[320px]"
            draggable={false}
          />
        ) : qrError ? (
          <span className="text-xs text-red-500 px-4 text-center">
            {qrError}
          </span>
        ) : (
          <Lucide.Loader2 className="w-8 h-8 text-zinc-400 animate-spin" />
        )}
      </div>

      <div className="w-full max-w-md flex flex-col gap-2">
        <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 font-semibold">
          OR open this URL on the device
        </div>
        <div className="flex items-stretch gap-2">
          <input
            type="text"
            readOnly
            value={sidecarUrl ?? "Initialising…"}
            className="flex-1 min-w-0 h-9 px-3 text-xs font-mono text-zinc-200 bg-zinc-900 border border-zinc-800 rounded-md select-all"
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
            className="h-9 shrink-0"
          >
            {copyStatus === "copied" ? "Copied" : "Copy"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ConnectedBody — identity card once the hello has arrived.
// ---------------------------------------------------------------------------

function ConnectedBody({
  entry,
  onDisconnect,
}: {
  entry: PairedPeerEntry;
  onDisconnect: () => void;
}) {
  const identity = entry.identity;
  return (
    <div className="flex flex-col items-center gap-5 py-3">
      <div
        className="flex items-center justify-center w-20 h-20 rounded-full border-2"
        style={{
          borderColor: identity?.color ?? "#3b82f6",
          backgroundColor: `${identity?.color ?? "#3b82f6"}1f`,
        }}
        aria-label={`Connected device: ${identity?.name ?? "Unknown"}`}
      >
        <LucideByName
          name={identity?.icon ?? "Monitor"}
          className="w-10 h-10"
          color={identity?.color ?? "#3b82f6"}
        />
      </div>

      <div className="flex flex-col items-center gap-1 text-center">
        <div className="text-base font-semibold text-zinc-100">
          {identity?.name ?? "Unknown device"}
        </div>
        <div className="text-xs text-zinc-400 capitalize">
          {entry.deviceTier ?? "device"}
        </div>
      </div>

      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-medium">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />
        Connected — close to send panels to this device
      </div>

      <Button
        variant="secondary"
        size="sm"
        onClick={onDisconnect}
        leadingIcon={<Lucide.PlugZap size={12} />}
        className="border-red-500/40 text-red-300 hover:bg-red-500/10"
      >
        Disconnect
      </Button>
    </div>
  );
}

/**
 * Render a lucide icon by name. Mirrors the helper in
 * `sidecar/components/IdentityWizard.tsx` so the desktop renders the
 * sidecar's chosen icon faithfully. Falls back to `Square` on unknown
 * names.
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
    return <Lucide.Square className={className} color={color} />;
  }
  return <Icon className={className} color={color} />;
}
