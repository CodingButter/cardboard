import { test, expect } from "bun:test";
import {
  SIDECAR_PANEL_REGISTRY,
  resolveSidecarPanel,
} from "./panelRegistry";

/**
 * Sidecar panel registry smoke tests — verify M2 ships ≥ 3 distinct
 * panel kinds and that `resolveSidecarPanel` always returns SOMETHING
 * (forward-compat: unknown kinds get the fallback, never undefined).
 */

test("registry exposes at least three semantic panel kinds", () => {
  const distinct = new Set(Object.values(SIDECAR_PANEL_REGISTRY));
  expect(distinct.size).toBeGreaterThanOrEqual(3);
});

test("resolveSidecarPanel returns the registered component for known kinds", () => {
  for (const kind of Object.keys(SIDECAR_PANEL_REGISTRY)) {
    const resolved = resolveSidecarPanel(kind);
    expect(resolved).toBe(SIDECAR_PANEL_REGISTRY[kind]!);
  }
});

test("resolveSidecarPanel returns a fallback for unknown kinds", () => {
  // Forward-compat: unknown kinds must NEVER throw; they render a
  // friendly fallback so a stray `mountPanel` doesn't crash the
  // sidecar.
  const fallback = resolveSidecarPanel("__definitely-not-registered__");
  expect(typeof fallback).toBe("function");
});

test("the fallback is NOT one of the registered concrete panels", () => {
  const registered = new Set(Object.values(SIDECAR_PANEL_REGISTRY));
  const fallback = resolveSidecarPanel("__definitely-not-registered__");
  expect(registered.has(fallback)).toBe(false);
});
