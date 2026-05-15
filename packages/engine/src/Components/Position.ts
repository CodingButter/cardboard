import { Component } from "ECS";
import { Vec2 } from "Libs/Vector";

/* --- Spatial ------------------------------------------------------------- */

/** World-space position in tile units. */
export const Position = new Component<Vec2>("Position");
