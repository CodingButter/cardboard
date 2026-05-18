import React from "react";
import { cn } from "../../lib/cn";

/**
 * AssetThumbnail — Phase 1 primitive.
 *
 * Aspect-ratio preview tile with a truncated caption + optional badges
 * overlaid in the corner. Used on Assets browser, Image Lab / Sound
 * Lab asset bins, Home recent-projects gallery, Animation clips list,
 * and the Map tile-preset rail.
 *
 * Mockups: most pages — see inventory §2.4 row "AssetThumbnail".
 *
 * Surface classes consumed: `.asset-thumb`, `.asset-thumb--active`,
 * `.asset-thumb__label`.
 */

export interface AssetThumbnailProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onClick"> {
  /** Image source. When omitted, a placeholder glyph fills the tile. */
  src?: string;
  /** Display name shown in the bottom gradient strip. */
  name?: React.ReactNode;
  /** Optional caption beneath the name (size, type, …). */
  caption?: React.ReactNode;
  /** Render an active amber ring around the tile. */
  selected?: boolean;
  /** Badges layered in the top-right corner (e.g. Animated, 32×32). */
  badges?: React.ReactNode;
  /** Aspect ratio. Default 1/1 (square). */
  aspect?: "square" | "video" | "portrait";
  /** Tile size preset. */
  size?: "sm" | "md" | "lg";
  /** Placeholder icon when `src` is omitted. */
  fallbackIcon?: React.ReactNode;
  onClick?: () => void;
}

const ASPECT_CLASS: Record<NonNullable<AssetThumbnailProps["aspect"]>, string> = {
  square: "aspect-square",
  video: "aspect-video",
  portrait: "aspect-[3/4]",
};

const SIZE_CLASS: Record<NonNullable<AssetThumbnailProps["size"]>, string> = {
  sm: "w-20",
  md: "w-28",
  lg: "w-40",
};

export function AssetThumbnail({
  src,
  name,
  caption,
  selected = false,
  badges,
  aspect = "square",
  size = "md",
  fallbackIcon,
  onClick,
  className,
  ...rest
}: AssetThumbnailProps) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "asset-thumb group block text-left",
        ASPECT_CLASS[aspect],
        SIZE_CLASS[size],
        selected && "asset-thumb--active",
        className,
      )}
      {...(rest as React.HTMLAttributes<HTMLElement>)}
    >
      <div className="absolute inset-0 flex items-center justify-center">
        {src ? (
          <img
            src={src}
            alt={typeof name === "string" ? name : ""}
            className="w-full h-full object-cover"
            draggable={false}
          />
        ) : (
          <span className="text-zinc-600">{fallbackIcon ?? <Placeholder />}</span>
        )}
      </div>
      {badges && (
        <div className="absolute top-1 right-1 flex items-center gap-1">
          {badges}
        </div>
      )}
      {(name || caption) && (
        <div className="asset-thumb__label">
          {name && <div className="truncate">{name}</div>}
          {caption && (
            <div className="text-[9px] text-zinc-400 truncate">{caption}</div>
          )}
        </div>
      )}
    </Tag>
  );
}

function Placeholder() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-5-5L5 21" />
    </svg>
  );
}
