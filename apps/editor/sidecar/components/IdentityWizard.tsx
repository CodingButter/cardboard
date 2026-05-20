import React from "react";
import * as Lucide from "lucide-react";
import {
  ABSTRACT_ICONS,
  ALL_ICONS,
  DEVICE_TYPE_ICONS,
  IDENTITY_PALETTE,
  createDefaultIdentity,
  saveIdentity,
  type SidecarIdentity,
} from "../lib/identityStore";
import { detectDeviceTier } from "../lib/deviceTier";

/**
 * IdentityWizard — single-page form for configuring this device's
 * persistent identity (name + colour + icon).
 *
 * Per REMOTE_DOCK_QR.md §5b: identity lives on the DEVICE, not the
 * desktop. Once set here it travels with the hardware. The same iPad
 * announces "Workshop Tablet 🔥" whether it pairs with your home Mac,
 * your work laptop, or a friend's PC.
 *
 * Layout: single scrollable card; large touch targets (48px+). Skip
 * button mints a tier-default placeholder ("Tablet #N" / "Phone #N" /
 * "Desktop #N").
 */

interface IdentityWizardProps {
  /** Called when the user saves (or skips with a default). */
  onComplete: (identity: SidecarIdentity) => void;
  /** Called when the user backs out without saving. Optional. */
  onCancel?: () => void;
  /** Existing identity to edit; absent for first-launch flow. */
  existing?: SidecarIdentity | null;
}

/**
 * Render a lucide icon by name. Returns a fallback box if the name is
 * unknown (shouldn't happen given the curated list, but defensive).
 */
function LucideByName({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Icon = (Lucide as Record<string, any>)[name] as
    | React.ComponentType<{ className?: string; size?: number }>
    | undefined;
  if (!Icon) {
    return <Lucide.Square className={className} />;
  }
  return <Icon className={className} />;
}

export function IdentityWizard({
  onComplete,
  onCancel,
  existing,
}: IdentityWizardProps) {
  const tier = React.useMemo(() => detectDeviceTier(), []);
  const [name, setName] = React.useState(existing?.name ?? "");
  const [color, setColor] = React.useState(
    existing?.color ?? IDENTITY_PALETTE[1] ?? "#f59e0b",
  );
  const [icon, setIcon] = React.useState(
    existing?.icon ??
      (tier === "tablet" ? "Tablet" : tier === "mobile" ? "Smartphone" : "Monitor"),
  );
  const [busy, setBusy] = React.useState(false);

  const canSave = name.trim().length > 0;

  async function handleSave() {
    if (!canSave || busy) return;
    setBusy(true);
    try {
      const identity: SidecarIdentity = {
        name: name.trim(),
        color,
        icon,
        tier,
        updatedAt: Date.now(),
      };
      await saveIdentity(identity);
      onComplete(identity);
    } finally {
      setBusy(false);
    }
  }

  async function handleSkip() {
    if (busy) return;
    setBusy(true);
    try {
      const id = await createDefaultIdentity(tier);
      onComplete(id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen w-full flex flex-col items-stretch bg-[#0a0a0c] text-zinc-100 px-5 py-6">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-semibold tracking-tight">Configure device</h1>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="text-zinc-400 hover:text-zinc-200 min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Cancel"
          >
            <Lucide.X size={20} />
          </button>
        )}
      </header>

      <p className="text-sm text-zinc-400 mb-6 leading-relaxed">
        This identity travels with this device. When you pair with a
        desktop the editor will see this name, colour, and icon.
      </p>

      {/* Name */}
      <label className="block mb-6">
        <span className="text-xs uppercase tracking-wider text-zinc-400 font-semibold mb-2 block">
          Name
        </span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={`e.g. Workshop ${tier === "mobile" ? "Phone" : tier === "tablet" ? "Tablet" : "Mac"}`}
          maxLength={48}
          className="w-full h-12 px-4 rounded-lg bg-zinc-900 border border-zinc-800 text-base text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
        />
      </label>

      {/* Colour */}
      <fieldset className="mb-6">
        <legend className="text-xs uppercase tracking-wider text-zinc-400 font-semibold mb-2">
          Colour
        </legend>
        <div className="grid grid-cols-6 gap-3" role="radiogroup" aria-label="Colour">
          {IDENTITY_PALETTE.map((swatch) => {
            const active = swatch === color;
            return (
              <button
                key={swatch}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setColor(swatch)}
                className={`relative aspect-square min-h-[44px] min-w-[44px] rounded-full transition-transform ${active ? "ring-2 ring-zinc-100 ring-offset-2 ring-offset-[#0a0a0c] scale-105" : "ring-1 ring-zinc-800"}`}
                style={{ backgroundColor: swatch }}
                aria-label={`Colour ${swatch}`}
              />
            );
          })}
        </div>
      </fieldset>

      {/* Icon */}
      <fieldset className="mb-6">
        <legend className="text-xs uppercase tracking-wider text-zinc-400 font-semibold mb-2">
          Icon
        </legend>
        <p className="text-[11px] text-zinc-500 mb-2">Device type</p>
        <div className="grid grid-cols-6 gap-2 mb-4" role="radiogroup" aria-label="Device icon">
          {DEVICE_TYPE_ICONS.map((n) => (
            <IconButton
              key={n}
              name={n}
              active={icon === n}
              tint={color}
              onClick={() => setIcon(n)}
            />
          ))}
        </div>
        <p className="text-[11px] text-zinc-500 mb-2">Marker</p>
        <div className="grid grid-cols-6 gap-2" role="radiogroup" aria-label="Marker icon">
          {ABSTRACT_ICONS.map((n) => (
            <IconButton
              key={n}
              name={n}
              active={icon === n}
              tint={color}
              onClick={() => setIcon(n)}
            />
          ))}
        </div>
      </fieldset>

      {/* Preview */}
      <div className="mb-8 p-4 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center gap-3">
        <div
          className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${color}33`, color }}
        >
          <LucideByName name={icon} className="w-6 h-6" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-zinc-100 truncate">
            {name.trim() || "Unnamed device"}
          </p>
          <p className="text-xs text-zinc-500 capitalize">{tier}</p>
        </div>
      </div>

      {/* Actions — sticky at the bottom of the column so they stay
          reachable on phone keyboards. */}
      <div className="mt-auto flex flex-col gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave || busy}
          className="h-12 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-900 font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Save identity
        </button>
        {!existing && (
          <button
            type="button"
            onClick={handleSkip}
            disabled={busy}
            className="h-12 rounded-lg border border-zinc-700 text-zinc-300 text-sm hover:bg-zinc-900"
          >
            Skip — use default
          </button>
        )}
      </div>

      {/* Ensure the icon set is referenced so Tailwind tree-shake never
          drops it. The list is in identityStore.ts; we re-export to keep
          a static reference here too. */}
      <span hidden aria-hidden>{ALL_ICONS.join(",")}</span>
    </div>
  );
}

function IconButton({
  name,
  active,
  tint,
  onClick,
}: {
  name: string;
  active: boolean;
  tint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      aria-label={name}
      onClick={onClick}
      className={`aspect-square min-h-[44px] min-w-[44px] rounded-lg flex items-center justify-center transition-colors ${active ? "border-2" : "border border-zinc-800 bg-zinc-900 text-zinc-400"}`}
      style={
        active
          ? { borderColor: tint, backgroundColor: `${tint}22`, color: tint }
          : undefined
      }
    >
      <LucideByName name={name} className="w-5 h-5" />
    </button>
  );
}
