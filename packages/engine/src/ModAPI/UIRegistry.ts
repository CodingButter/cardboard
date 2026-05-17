/* @jsxImportSource preact */
import { h, render, type ComponentType, type VNode } from "preact";
import type ModalRegistry from "ModalRegistry";
import type { UIAPI } from "./types";

/**
 * Backs the `api.ui` field. Tracks `name → { component, props }` pairs
 * registered by pack scripts via `api.ui.registerModal`, and renders
 * the active set into a single Preact mount point above the canvas.
 *
 * The engine drives the reconcile loop: every frame's update tick, the
 * `Game` calls `flush()` which walks the engine's `ModalRegistry` and
 * — for each open modal name with a registered component — renders the
 * component into the mount with fresh props. Closing a modal renders
 * `null` into the mount so the DOM is torn down cleanly.
 *
 * Why a single mount instead of per-modal mounts? Two reasons:
 *   1. The old engine-owned modal systems each `appendChild`'d their
 *      own DOM node and were the ones rendering. Centralising the
 *      mount makes the engine, not the pack, the owner of the modal
 *      DOM layer — the pack can be replaced wholesale and the engine
 *      still tears down cleanly.
 *   2. Modals are mutually exclusive in practice today (the registry's
 *      `anyOther` check guards opens). The single mount enforces that
 *      assumption at the render layer: only the first open modal in
 *      iteration order gets drawn. If we later want stacked modals
 *      this becomes a `<Fragment>` of all open components — same API.
 */
export class UIRegistry implements UIAPI {
  private readonly entries = new Map<
    string,
    { component: ComponentType<unknown>; props?: () => unknown }
  >();
  private readonly mount: HTMLDivElement;
  /** Last name we rendered something into the mount for. `null` = mount currently empty. */
  private lastRendered: string | null = null;

  constructor(private readonly modals: ModalRegistry) {
    // Self-healing-on-HMR: an HMR reload re-runs `Game`'s constructor,
    // which builds a fresh UIRegistry. Any prior mount left over from
    // the previous instance is now orphaned — sweep it up so we don't
    // accumulate stacked `<div>`s in `<body>`.
    const ATTR = "data-engine-ui-mount";
    document.querySelectorAll(`[${ATTR}]`).forEach((stale) => stale.remove());
    const mount = document.createElement("div");
    mount.setAttribute(ATTR, "true");
    document.body.appendChild(mount);
    this.mount = mount;
  }

  registerModal<P>(
    name: string,
    component: ComponentType<P>,
    props?: () => P,
  ): void {
    this.entries.set(name, {
      component: component as unknown as ComponentType<unknown>,
      props: props as (() => unknown) | undefined,
    });
  }

  unregisterModal(name: string): void {
    this.entries.delete(name);
    if (this.lastRendered === name) {
      render(null, this.mount);
      this.lastRendered = null;
    }
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  /**
   * Called by `Game.update` every frame. Picks the first open modal
   * with a registered component and renders it; renders `null` when no
   * registered modal is open. We re-render every frame so callbacks
   * passed via `props()` see fresh state — pack systems that read live
   * fields (CONFIG, inventory mutations) rely on this.
   */
  flush(): void {
    let activeName: string | null = null;
    for (const name of this.entries.keys()) {
      if (this.modals.isOpen(name)) {
        activeName = name;
        break;
      }
    }
    if (activeName === null) {
      if (this.lastRendered !== null) {
        render(null, this.mount);
        this.lastRendered = null;
      }
      return;
    }
    const entry = this.entries.get(activeName)!;
    const props = entry.props ? entry.props() : {};
    const node: VNode = h(
      entry.component as ComponentType<unknown>,
      props as Record<string, unknown>,
    );
    render(node, this.mount);
    this.lastRendered = activeName;
  }
}
