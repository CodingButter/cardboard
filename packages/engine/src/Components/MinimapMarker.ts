import { Component } from "ECS";

/** Style for an entity's dot on the minimap. */
export interface MinimapMarkerData {
  /** Fill color as a CSS string. */
  color: string;
  /** Radius in tile units. */
  radius: number;
  /**
   * If `true` and the entity has Facing, draw a debug ray from this marker
   * out to the first wall hit. Only the player wants this on by default.
   */
  drawForwardRay: boolean;
}
export const MinimapMarker = new Component<MinimapMarkerData>("MinimapMarker");
