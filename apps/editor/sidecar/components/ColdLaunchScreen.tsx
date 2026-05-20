import React from "react";
import * as Lucide from "lucide-react";
import QrScanner from "qr-scanner";
import type { SidecarIdentity } from "../lib/identityStore";

/**
 * ColdLaunchScreen — the entry surface when the SideCar PWA opens with
 * no `peer` URL param. Per REMOTE_DOCK_QR.md §5:
 *
 *  - Live camera preview + QR scanner via the `qr-scanner` library.
 *  - Recent-sessions list (last-N peer ids in IDB). D9 ships the empty
 *    state; D12 wires the actual IDB-backed list.
 *  - Paste-URL fallback for when scanning isn't an option (e.g. URL
 *    came via Slack).
 *  - "Configure device" link opens the identity wizard.
 *
 * Touch-first: hit targets ≥ 44px, no hover-only effects, no Tooltip
 * primitive (the editor's Tooltip is a desktop-only affordance).
 */

interface ColdLaunchScreenProps {
  identity: SidecarIdentity | null;
  /** Navigate to the identity wizard ("Configure device"). */
  onOpenIdentityWizard: () => void;
  /**
   * Called when the user produces a URL (via QR scan or paste) that
   * targets this sidecar. The parent navigates to it (which then re-
   * renders ConnectingScreen).
   */
  onJoinUrl: (url: string) => void;
}

type ScannerState = "idle" | "starting" | "running" | "error";

export function ColdLaunchScreen({
  identity,
  onOpenIdentityWizard,
  onJoinUrl,
}: ColdLaunchScreenProps) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const scannerRef = React.useRef<QrScanner | null>(null);
  const [scannerState, setScannerState] = React.useState<ScannerState>("idle");
  const [scannerError, setScannerError] = React.useState<string | null>(null);
  const [pasteValue, setPasteValue] = React.useState("");
  const [pasteError, setPasteError] = React.useState<string | null>(null);

  // Start the scanner on mount. The library handles getUserMedia +
  // BarcodeDetector fallback internally. We tear it down on unmount.
  React.useEffect(() => {
    let cancelled = false;
    async function start() {
      const video = videoRef.current;
      if (!video) return;
      setScannerState("starting");
      try {
        const scanner = new QrScanner(
          video,
          (result) => {
            const text = typeof result === "string" ? result : result.data;
            if (text) handleScan(text);
          },
          {
            highlightScanRegion: true,
            highlightCodeOutline: true,
            preferredCamera: "environment",
          },
        );
        await scanner.start();
        if (cancelled) {
          scanner.stop();
          scanner.destroy();
          return;
        }
        scannerRef.current = scanner;
        setScannerState("running");
      } catch (err) {
        if (cancelled) return;
        console.warn("[sidecar] QR scanner failed to start:", err);
        setScannerError(
          err instanceof Error ? err.message : "Camera unavailable",
        );
        setScannerState("error");
      }
    }
    start();
    return () => {
      cancelled = true;
      const s = scannerRef.current;
      if (s) {
        try {
          s.stop();
          s.destroy();
        } catch {
          /* noop */
        }
        scannerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleScan(text: string) {
    // Only trust URLs that look like a sidecar join URL. Otherwise
    // ignore — many QR codes in the wild are unrelated (wifi, vCard).
    try {
      const u = new URL(text, window.location.href);
      if (!u.searchParams.has("peer")) return;
      onJoinUrl(u.toString());
    } catch {
      /* not a URL — ignore */
    }
  }

  function handlePasteSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPasteError(null);
    const raw = pasteValue.trim();
    if (!raw) return;
    try {
      const u = new URL(raw, window.location.href);
      if (!u.searchParams.has("peer")) {
        setPasteError("That URL is missing the peer id.");
        return;
      }
      onJoinUrl(u.toString());
    } catch {
      setPasteError("Couldn't parse that as a URL.");
    }
  }

  return (
    <div className="min-h-screen w-full bg-[#0a0a0c] text-zinc-100 flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-4 border-b border-zinc-900">
        <div className="flex items-center gap-2">
          <div
            className="w-8 h-8 rounded-md flex items-center justify-center"
            style={{
              backgroundColor: identity ? `${identity.color}22` : "#1a1814",
              color: identity?.color ?? "#f59e0b",
            }}
          >
            <Lucide.QrCode className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-tight leading-tight">
              SideCar
            </h1>
            {identity ? (
              <p className="text-[11px] text-zinc-500 leading-tight">
                {identity.name}
              </p>
            ) : (
              <p className="text-[11px] text-zinc-500 leading-tight">
                Cardboard remote dock
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onOpenIdentityWizard}
          className="text-zinc-400 hover:text-zinc-200 min-h-[44px] min-w-[44px] flex items-center justify-center"
          aria-label="Configure device"
        >
          <Lucide.Settings size={20} />
        </button>
      </header>

      <main className="flex-1 flex flex-col gap-6 px-5 py-6">
        {/* Camera preview */}
        <section>
          <h2 className="text-xs uppercase tracking-wider text-zinc-400 font-semibold mb-3">
            Scan to pair
          </h2>
          <div className="relative aspect-square w-full max-w-md mx-auto rounded-xl overflow-hidden bg-zinc-950 border border-zinc-900">
            <video
              ref={videoRef}
              className="absolute inset-0 w-full h-full object-cover"
              playsInline
              muted
            />
            {scannerState !== "running" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-6 bg-black/40">
                {scannerState === "error" ? (
                  <>
                    <Lucide.Camera className="w-10 h-10 text-zinc-500" />
                    <p className="text-sm text-zinc-300 max-w-xs">
                      Camera unavailable.
                    </p>
                    {scannerError && (
                      <p className="text-[11px] text-zinc-500 max-w-xs">
                        {scannerError}
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <Lucide.Loader className="w-8 h-8 text-zinc-500 animate-spin" />
                    <p className="text-sm text-zinc-400">Starting camera…</p>
                  </>
                )}
              </div>
            )}
          </div>
          <p className="mt-3 text-[12px] text-zinc-500 text-center">
            Point the camera at the QR shown by the desktop editor.
          </p>
        </section>

        {/* Recent sessions */}
        <section>
          <h2 className="text-xs uppercase tracking-wider text-zinc-400 font-semibold mb-3">
            Recent sessions
          </h2>
          <div className="rounded-lg border border-zinc-900 bg-zinc-950/60 px-4 py-5 text-center">
            <Lucide.Compass className="w-6 h-6 text-zinc-700 mx-auto mb-2" />
            <p className="text-sm text-zinc-400">No recent sessions yet.</p>
            <p className="text-[11px] text-zinc-600 mt-1">
              Past pairings will appear here after you connect.
            </p>
          </div>
        </section>

        {/* Paste URL */}
        <section>
          <h2 className="text-xs uppercase tracking-wider text-zinc-400 font-semibold mb-3">
            Or paste a join URL
          </h2>
          <form onSubmit={handlePasteSubmit} className="flex flex-col gap-2">
            <input
              type="url"
              value={pasteValue}
              onChange={(e) => {
                setPasteValue(e.target.value);
                setPasteError(null);
              }}
              placeholder="https://…/sidecar/?peer=…"
              inputMode="url"
              autoComplete="off"
              className="h-12 px-4 rounded-lg bg-zinc-900 border border-zinc-800 text-base text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
            />
            {pasteError && (
              <p className="text-[11px] text-red-400">{pasteError}</p>
            )}
            <button
              type="submit"
              disabled={!pasteValue.trim()}
              className="h-12 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-900 font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Join session
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
