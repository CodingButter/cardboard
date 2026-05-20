import React from "react";
import * as Lucide from "lucide-react";
import type { SidecarIdentity } from "../lib/identityStore";
import { resolveSidecarPanel } from "../lib/panelRegistry";

/**
 * MountedPanelScreen — the screen the sidecar swaps to once the desktop
 * has fired a `mountPanel` WireMessage we recognise.
 *
 * Lifecycle:
 *
 *   1. `ConnectingScreen` subscribes to the transport's inbound stream.
 *      When a `mountPanel` arrives + the kind resolves in the registry,
 *      it stores it as `mounted` state and renders THIS component
 *      instead of the connected-placeholder.
 *
 *   2. The back button calls `onDismiss`, which sends an `unmountPanel`
 *      WireMessage to the desktop and clears the local mounted state.
 *
 *   3. If the desktop sends a SECOND `mountPanel`, the first is
 *      replaced; we don't stack panels yet. (Tablet-tier multi-pane is
 *      a future phase.)
 *
 * Touch-first chrome — the back button is a 48-px tap target with a
 * generous label. The header retains the device-identity badge so the
 * sidecar still feels like the same surface across the swap.
 */

export interface MountedPanelScreenProps {
  identity: SidecarIdentity | null;
  /** `panelKind` from the `mountPanel` payload. */
  panelKind: string;
  /** `label` from the `mountPanel` payload. */
  label: string;
  /** Optional reserved-for-D11+ initial state snapshot. */
  initialState?: unknown;
  /** Back button — should send `unmountPanel` then clear mount state. */
  onDismiss: () => void;
}

export function MountedPanelScreen({
  identity,
  panelKind,
  label,
  initialState,
  onDismiss,
}: MountedPanelScreenProps): React.JSX.Element {
  const PanelComponent = React.useMemo(
    () => resolveSidecarPanel(panelKind),
    [panelKind],
  );

  const tier = identity?.tier ?? "mobile";

  return (
    <div className="min-h-screen w-full bg-[#0a0a0c] text-zinc-100 flex flex-col">
      <header className="flex items-center justify-between px-3 py-3 border-b border-zinc-900 sticky top-0 bg-[#0a0a0c]/95 backdrop-blur z-10">
        <button
          type="button"
          onClick={onDismiss}
          className="min-h-[48px] min-w-[48px] px-3 -ml-2 rounded-lg flex items-center gap-2 text-zinc-300 active:bg-zinc-800/80"
          aria-label="Dismiss panel and return to identity screen"
          data-testid="sidecar-mounted-panel-back"
        >
          <Lucide.ChevronLeft className="w-6 h-6" />
          <span className="text-sm font-medium">Back</span>
        </button>
        <div className="flex items-center gap-2 min-w-0">
          {identity && (
            <div
              className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
              style={{
                backgroundColor: `${identity.color}22`,
                color: identity.color,
              }}
              aria-label={identity.name}
              title={identity.name}
            >
              <Lucide.Tablet className="w-4 h-4" />
            </div>
          )}
          <h1
            className="text-sm font-semibold tracking-tight truncate max-w-[60vw]"
            data-testid="sidecar-mounted-panel-label"
          >
            {label}
          </h1>
        </div>
        <div
          className="w-12 h-1 rounded-full bg-emerald-500/40"
          aria-hidden="true"
          title="Live channel"
        />
      </header>

      <main
        className="flex-1 flex flex-col"
        data-testid={`sidecar-mounted-panel-${panelKind}`}
        data-panel-kind={panelKind}
      >
        <PanelComponent
          label={label}
          tier={tier}
          initialState={initialState}
        />
      </main>
    </div>
  );
}
