/**
 * ScenePreview3D — Scene page right-rail "3D Preview" card body.
 *
 * Phase 2 Wave A stub: thin wrapper around the existing `CellPreview`
 * module so the layout file in `MapView.tsx` can drop a single
 * `<ScenePreview3D ... />` instead of inlining the (very prop-heavy)
 * CellPreview directly. All props pass through unchanged — Wave A is
 * pure structural extraction, no behavioural changes.
 *
 * Wave B will:
 *  - Trim the prop surface to the bits the Scene tab actually exposes
 *    (the inline + modal cases share most fields, which suggests
 *    promoting a `useScenePreviewState()` hook into this module).
 *  - Surface "open expanded" / "settings" / "auto-rotate" controls on
 *    the card header (today they live inside CellPreview).
 *
 * Mockup: `Editor Design/Map.png` (right-rail card 1 — "3D PREVIEW"
 * with the LIVE indicator).
 */
import React from "react";
import { CellPreview } from "../CellPreview";
import type { CellPreviewOrbitState } from "../CellPreview";
import type {
  CellPreviewLightmapSource,
  ResolvedPresetData,
} from "@two_5_d/engine";

export interface ScenePreview3DProps {
  projectId: string;
  presetId: string | null;
  presetData: ResolvedPresetData | null;
  textureUrl?: string | null;
  layer: "walls" | "floors" | "ceiling";
  autoRotate: boolean;
  onAutoRotateChange: (next: boolean) => void;
  floorPresetId?: string | null;
  floorPresetData?: ResolvedPresetData | null;
  floorTextureUrl?: string | null;
  ceilingPresetId?: string | null;
  ceilingPresetData?: ResolvedPresetData | null;
  ceilingTextureUrl?: string | null;
  expanded?: boolean;
  onToggleExpanded?: () => void;
  onClose?: () => void;
  sharedOrbitRef: React.MutableRefObject<CellPreviewOrbitState>;
  showWalls: boolean;
  setShowWalls: (next: boolean) => void;
  showFloors: boolean;
  setShowFloors: (next: boolean) => void;
  showCeilings: boolean;
  setShowCeilings: (next: boolean) => void;
  roomSize: number;
  setRoomSize: (next: number) => void;
  floorPresetOverride: string | null;
  setFloorPresetOverride: (next: string | null) => void;
  ceilingPresetOverride: string | null;
  setCeilingPresetOverride: (next: string | null) => void;
  wallPresetOverride: string | null;
  setWallPresetOverride: (next: string | null) => void;
  autoRotateSpeed: number;
  setAutoRotateSpeed: (next: number) => void;
  presetOptions: ReadonlyArray<{
    id: string;
    label: string;
    sourcePath: string;
  }>;
  lightmapSource: CellPreviewLightmapSource | null;
}

export function ScenePreview3D(props: ScenePreview3DProps) {
  // The right-rail card adds its own border + radius; CellPreview wants
  // to bleed slightly outside the section's gutter so the canvas reads
  // edge-to-edge inside the card. The same -mx-3 -my-2 inset existed in
  // the previous inline JSX inside MapView.
  return (
    <div className="-mx-3 -my-2">
      <CellPreview {...props} />
    </div>
  );
}
