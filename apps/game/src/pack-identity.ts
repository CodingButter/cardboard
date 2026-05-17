import type { AssetPack } from "@two_5_d/engine";

/**
 * Pack-driven identity wiring. Reads pack-author convention fields
 * off `pack.manifest` (`name`, `shortName`, `themeColor`, `iconSizes`)
 * and rewrites the document title, favicon, and PWA manifest at
 * runtime so the game tab takes on the pack's identity.
 *
 * Engine notes: `iconSizes`, `shortName`, `themeColor`, and `icon` are
 * pack-author convention fields the engine treats as opaque metadata.
 * They're produced by the pack-builder (`apps/pack-builder/src/icon-
 * pipeline.ts`) when the manifest carries `icon`; if the pack didn't
 * declare them, this function leaves the document defaults in place.
 *
 * Defensive across SSR / smoke tests — every browser-API call is
 * gated by a `typeof document !== "undefined"` check at the caller
 * (see `apps/game/index.ts`).
 */
export interface PackIdentityExtras {
  name: string;
  shortName?: string;
  themeColor?: string;
  iconSizes?: Record<string, string>;
}

/**
 * Pull the convention fields off `pack.manifest`. They're not declared
 * on `PackManifest` today (engine touch is out of scope for this
 * change), so we read them via a defensive `unknown` cast.
 */
function readIdentity(pack: AssetPack): PackIdentityExtras {
  const extras = pack.manifest as unknown as {
    shortName?: string;
    themeColor?: string;
    iconSizes?: Record<string, string>;
  };
  return {
    name: pack.manifest.name,
    shortName: extras.shortName,
    themeColor: extras.themeColor,
    iconSizes: extras.iconSizes,
  };
}

/** Replace any existing `<link rel="icon">` with one pointing at `url`. */
function setFavicon(url: string): void {
  // Strip every existing favicon so a previous pack's icon doesn't
  // linger when the user navigates between packs in the same tab.
  for (const link of Array.from(document.querySelectorAll('link[rel="icon"]'))) {
    link.parentElement?.removeChild(link);
  }
  const link = document.createElement("link");
  link.rel = "icon";
  link.type = "image/png";
  link.href = url;
  document.head.appendChild(link);
}

/**
 * Regenerate the PWA web app manifest from pack-supplied metadata and
 * point the `<link rel="manifest">` tag at it. We use a Blob URL so
 * the manifest stays in-memory — the static `/manifest.webmanifest`
 * is replaced at runtime rather than overwritten.
 */
function setPwaManifest(
  identity: PackIdentityExtras,
  iconUrls: Record<string, string>,
): void {
  const themeColor = identity.themeColor ?? "#08090b";
  const manifest = {
    name: identity.name,
    short_name: identity.shortName ?? identity.name,
    icons: [
      iconUrls["192"]
        ? { src: iconUrls["192"], sizes: "192x192", type: "image/png" }
        : null,
      iconUrls["512"]
        ? { src: iconUrls["512"], sizes: "512x512", type: "image/png" }
        : null,
      iconUrls["maskable-512"]
        ? {
            src: iconUrls["maskable-512"],
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          }
        : null,
    ].filter((v) => v !== null),
    theme_color: themeColor,
    background_color: themeColor,
    display: "standalone",
    start_url: "/",
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(manifest)], { type: "application/manifest+json" }),
  );
  const link =
    document.querySelector<HTMLLinkElement>('link[rel="manifest"]') ??
    (() => {
      const created = document.createElement("link");
      created.rel = "manifest";
      document.head.appendChild(created);
      return created;
    })();
  link.href = url;
}

/**
 * Apply pack-driven identity to the document. Reads `iconSizes` off the
 * pack manifest, fetches each variant's bytes through the pack's
 * `textureBlob` API, builds object URLs, and rewrites:
 *
 *   1. `document.title`
 *   2. The `<link rel="icon">` (replacing any existing).
 *   3. The `<link rel="manifest">` (regenerated as a Blob URL).
 *
 * Also pushes `themeColor` onto the `<meta name="theme-color">` tag so
 * mobile browsers tint their chrome to match.
 *
 * Caller must gate on `typeof document !== "undefined"`. Silently
 * no-ops if the pack didn't ship `iconSizes` (favicon + manifest stay
 * at the build-time defaults), but still rewrites the title.
 */
export async function applyPackIdentity(pack: AssetPack): Promise<void> {
  const identity = readIdentity(pack);

  // 1. Title — always update; the pack always has a name.
  document.title = identity.name;

  // 1a. Theme-color meta — push out as soon as we know it so the
  //     mobile browser chrome retints before the icon work below
  //     races.
  if (identity.themeColor) {
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    meta.content = identity.themeColor;
  }

  // 2 + 3. Favicon + PWA manifest — only if the pack-builder emitted
  //         the iconSizes map. Otherwise leave the static defaults in
  //         place (browser-friendly fallback).
  const sizes = identity.iconSizes;
  if (!sizes) return;

  // Load every declared variant as a Blob, hand each one a fresh
  // object URL. We tolerate per-variant fetch failures so a stripped
  // pack (e.g. someone manually deleted the maskable file) still
  // applies the variants it *can* read.
  const iconUrls: Record<string, string> = {};
  for (const [key, path] of Object.entries(sizes)) {
    if (typeof path !== "string" || path.length === 0) continue;
    try {
      const blob = await pack.textureBlob(path);
      iconUrls[key] = URL.createObjectURL(blob);
    } catch (err) {
      console.warn(
        `[pack-identity] failed to load icon variant "${key}" (${path}):`,
        (err as Error).message,
      );
    }
  }

  if (iconUrls["192"]) {
    setFavicon(iconUrls["192"]);
  } else if (iconUrls["512"]) {
    setFavicon(iconUrls["512"]);
  }

  setPwaManifest(identity, iconUrls);
}
