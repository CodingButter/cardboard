import { Vec2 } from "Libs/Vector";

export function drawLine(ctx: CanvasRenderingContext2D, p1: Vec2, p2: Vec2) {
  ctx.beginPath();
  ctx.moveTo(...p1.array());
  ctx.lineTo(...p2.array());
  ctx.stroke();
  ctx.closePath();
}

export function drawCircle(ctx: CanvasRenderingContext2D, center: Vec2, radius: number) {
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius, 0, 2 * Math.PI);
  ctx.fill();
  ctx.closePath();
}
