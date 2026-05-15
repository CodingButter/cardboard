import { Component } from "ECS";

/**
 * Lying-on-the-floor pickup. Walking close enough to an entity with
 * this component triggers the `PickupSystem` to grant `count` of
 * `itemId` to the player's inventory and despawn the pickup. Bring
 * your own `Sprite` + `Position` for visuals.
 */
export interface PickupData {
  itemId: string;
  count: number;
}
export const Pickup = new Component<PickupData>("Pickup");
