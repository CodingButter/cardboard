import React from "react";
import { cn } from "../../lib/cn";

/**
 * Chart primitives — FpsGraph, PieChart, ChartLegend.
 *
 * Grouped into one file because they share the canvas-rendering
 * pattern and the same `variant` colour vocabulary. No external
 * charting lib — everything is imperative `useEffect` + 2D canvas.
 *
 * See EDITOR_REDESIGN.md §4.17, §4.21, §4.27.
 */

export type ChartVariant = "amber" | "emerald" | "sky" | "red" | "purple" | "zinc";

/** CSS colour for each variant. Keep aligned with §3.1. */
const VARIANT_COLOR: Record<ChartVariant, string> = {
  amber: "oklch(0.74 0.18 65)",
  emerald: "oklch(0.70 0.17 162)",
  sky: "oklch(0.74 0.15 235)",
  red: "oklch(0.65 0.22 25)",
  purple: "oklch(0.71 0.20 295)",
  zinc: "oklch(0.55 0 0)",
};

/* -------------------------------------------------------------------- */
/* FpsGraph — §4.17                                                      */
/* -------------------------------------------------------------------- */

export interface FpsGraphProps {
  /** Buffer of frame times (ms). Pass the latest N samples. */
  samples: ReadonlyArray<number>;
  /** Target frame time in ms (16.67 for 60fps). Drawn as ref line. */
  target?: number;
  width?: number;
  height?: number;
  legend?: React.ReactNode;
  className?: string;
}

export function FpsGraph({
  samples,
  target = 16.67,
  width = 220,
  height = 60,
  legend,
  className,
}: FpsGraphProps) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);

    // Background grid line at target.
    const max = Math.max(target * 2.5, ...samples, 1);
    const yFor = (v: number) => height - (v / max) * (height - 6) - 3;

    ctx.strokeStyle = "oklch(0.32 0 0 / 0.6)";
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(0, yFor(target));
    ctx.lineTo(width, yFor(target));
    ctx.stroke();
    ctx.setLineDash([]);

    if (samples.length === 0) return;

    // Frame-time line, amber under target, red above.
    const step = width / Math.max(1, samples.length - 1);
    for (let i = 0; i < samples.length - 1; i++) {
      const v0 = samples[i]!;
      const v1 = samples[i + 1]!;
      ctx.strokeStyle = v1 > target ? VARIANT_COLOR.red : VARIANT_COLOR.amber;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(i * step, yFor(v0));
      ctx.lineTo((i + 1) * step, yFor(v1));
      ctx.stroke();
    }
  }, [samples, target, width, height]);

  return (
    <div className={cn("inline-flex flex-col gap-1", className)}>
      <canvas
        ref={canvasRef}
        style={{ width, height }}
        className="rounded-md bg-zinc-950 border border-zinc-800"
      />
      {legend && <div className="text-[10px] text-zinc-500">{legend}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* PieChart — §4.21                                                      */
/* -------------------------------------------------------------------- */

export interface PieSegment {
  id: string;
  label: React.ReactNode;
  value: number;
  variant: ChartVariant;
}

export interface PieChartProps {
  segments: ReadonlyArray<PieSegment>;
  size?: number;
  innerRadius?: number;
  legend?: boolean;
  className?: string;
}

export function PieChart({
  segments,
  size = 96,
  innerRadius,
  legend = false,
  className,
}: PieChartProps) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const inner = innerRadius ?? size * 0.6;

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, size, size);

    const total = segments.reduce((s, seg) => s + seg.value, 0) || 1;
    const cx = size / 2;
    const cy = size / 2;
    const outerR = size / 2 - 1;
    const innerR = inner / 2;

    let theta = -Math.PI / 2;
    for (const seg of segments) {
      const slice = (seg.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(theta) * innerR, cy + Math.sin(theta) * innerR);
      ctx.arc(cx, cy, outerR, theta, theta + slice);
      ctx.arc(cx, cy, innerR, theta + slice, theta, true);
      ctx.closePath();
      ctx.fillStyle = VARIANT_COLOR[seg.variant];
      ctx.fill();
      theta += slice;
    }
  }, [segments, size, inner]);

  return (
    <div className={cn("inline-flex items-center gap-4", className)}>
      <canvas ref={canvasRef} style={{ width: size, height: size }} />
      {legend && (
        <ChartLegend
          layout="vertical"
          items={segments.map((s) => ({
            label: s.label,
            value: s.value,
            variant: s.variant,
          }))}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* ChartLegend — §4.27                                                   */
/* -------------------------------------------------------------------- */

export interface ChartLegendItem {
  label: React.ReactNode;
  variant: ChartVariant;
  value?: React.ReactNode;
}

export interface ChartLegendProps {
  items: ReadonlyArray<ChartLegendItem>;
  layout?: "horizontal" | "vertical";
  className?: string;
}

export function ChartLegend({
  items,
  layout = "vertical",
  className,
}: ChartLegendProps) {
  return (
    <ul
      className={cn(
        "text-xs",
        layout === "horizontal"
          ? "flex flex-wrap gap-x-4 gap-y-1"
          : "flex flex-col gap-1",
        className,
      )}
    >
      {items.map((it, i) => (
        <li key={i} className="flex items-center gap-2 text-zinc-300">
          <span
            className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
            style={{ background: VARIANT_COLOR[it.variant] }}
          />
          <span className="truncate flex-1">{it.label}</span>
          {it.value !== undefined && (
            <span className="font-mono text-zinc-400">{it.value}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
