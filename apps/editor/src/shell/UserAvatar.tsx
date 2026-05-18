import React from "react";
import { User as UserIcon } from "lucide-react";
import { cn } from "../lib/cn";

/**
 * UserAvatar — small circular avatar that lives in the TopBar to the
 * right of the settings cog. Placeholder visual for now (lucide User
 * icon over an elevated card-coloured circle); the shell can register a
 * real menu handler via `onOpenUserMenu` later.
 *
 * Sized at 32px to align with the other 32px chips on the right side
 * of the TopBar (Settings cog, action buttons). When `initials` is
 * provided we render them instead of the User icon — gives the surface
 * a personality once real user data is wired through.
 *
 * Mockup reference: Editor Design/Map.png — the rightmost circular
 * chip after the settings cog.
 */

export interface UserAvatarProps {
  /** Optional menu-open callback. No-op by default so the avatar is
   *  always interactive and reads as clickable even before the shell
   *  wires a real handler. */
  onOpenUserMenu?: () => void;
  /** Optional initials (1-2 chars) — rendered when supplied; otherwise
   *  the lucide User glyph is shown. */
  initials?: string;
  className?: string;
}

export function UserAvatar({
  onOpenUserMenu,
  initials,
  className,
}: UserAvatarProps) {
  const trimmed = initials?.trim().slice(0, 2).toUpperCase();
  return (
    <button
      type="button"
      onClick={onOpenUserMenu}
      aria-label="Open user menu"
      title="Account"
      className={cn(
        "inline-flex items-center justify-center w-8 h-8 rounded-full shrink-0",
        "bg-(--color-bg-card-elev) border border-(--color-border)",
        "text-zinc-300 hover:text-zinc-100 hover:border-(--color-border-accent)",
        "transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400",
        className,
      )}
    >
      {trimmed ? (
        <span className="text-[11px] font-semibold tracking-wide">{trimmed}</span>
      ) : (
        <UserIcon size={16} strokeWidth={2} />
      )}
    </button>
  );
}
