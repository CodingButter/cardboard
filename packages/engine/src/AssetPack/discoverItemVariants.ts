import { ITEM_IMAGE_VARIANTS, type ItemImageVariant } from "./types";

/**
 * Walk the pack's file list for siblings of `manifestPath` matching the
 * suffix convention. `manifestPath` can itself be a variant (e.g.
 * `rifle.icon.png`) — the variant suffix is stripped before scanning so
 * any starting filename in the family discovers the rest.
 *
 * `bare` is the manifest path with any variant suffix removed; included
 * only if that file actually exists in the pack.
 */
export function discoverItemVariants(
  has: (path: string) => boolean,
  manifestPath: string,
): Partial<Record<ItemImageVariant | "bare", string>> {
  const result: Partial<Record<ItemImageVariant | "bare", string>> = {};
  const slash = manifestPath.lastIndexOf("/");
  const dir = slash >= 0 ? manifestPath.slice(0, slash + 1) : "";
  const file = slash >= 0 ? manifestPath.slice(slash + 1) : manifestPath;
  const dot = file.lastIndexOf(".");
  if (dot < 0) {
    if (has(manifestPath)) result.bare = manifestPath;
    return result;
  }
  let base = file.slice(0, dot);
  const ext = file.slice(dot);
  for (const v of ITEM_IMAGE_VARIANTS) {
    if (base.endsWith(`.${v}`)) {
      base = base.slice(0, -(v.length + 1));
      break;
    }
  }
  const barePath = `${dir}${base}${ext}`;
  if (has(barePath)) result.bare = barePath;
  for (const v of ITEM_IMAGE_VARIANTS) {
    const candidate = `${dir}${base}.${v}${ext}`;
    if (has(candidate)) result[v] = candidate;
  }
  return result;
}
