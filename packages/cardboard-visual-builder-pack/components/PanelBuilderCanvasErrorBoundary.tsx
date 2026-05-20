/**
 * PanelBuilderCanvasErrorBoundary — VB6.
 *
 * Wraps the canvas's `<PanelRenderer>` so render-time exceptions inside
 * the recursive renderer don't take down the entire Panel Builder view.
 *
 * Why this is needed: a partially-edited node (e.g. an `Input` with no
 * `bind` yet, or a `Slider` whose `bind` references a store key that
 * doesn't exist) can throw inside the renderer's resolver. Without a
 * boundary, the whole `<PanelBuilderView>` unmounts and the user can't
 * fix the spec via the inspector.
 *
 * The boundary catches React render errors only — NOT errors thrown
 * inside event handlers, async tasks, or pack-script setup. Those need
 * their own try/catch at the call site.
 *
 * Reset semantics: every change to `resetKey` (the live spec reference)
 * resets the boundary so a fresh render attempt happens on every
 * mutation. The user clicking "Reset preview" forces a manual reset
 * via internal state bump.
 */

import React from "react";

interface Props {
  children: React.ReactNode;
  /** Bumping this resets the boundary — pass the current spec
   *  reference so each mutation gets a fresh render attempt. */
  resetKey: unknown;
}

interface State {
  error: Error | null;
}

export class PanelBuilderCanvasErrorBoundary extends React.Component<
  Props,
  State
> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Log to console so engine-side debugging still sees the stack.
    // eslint-disable-next-line no-console
    console.warn("[panelBuilder] canvas render error:", error, info);
  }

  componentDidUpdate(prevProps: Props): void {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      // Reset on next mutation so a fix in the inspector lets the
      // canvas re-render on the very next keystroke.
      this.setState({ error: null });
    }
  }

  private handleReset = (): void => {
    this.setState({ error: null });
  };

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div
          className="h-full w-full flex items-center justify-center p-4"
          data-testid="panel-builder-canvas-error"
        >
          <div className="max-w-sm rounded border border-rose-900/60 bg-rose-950/40 p-3 text-rose-200">
            <div className="text-[11px] uppercase tracking-wider text-rose-300 mb-1">
              Canvas render error
            </div>
            <div className="text-xs text-rose-200/90 mb-2 break-words">
              {this.state.error.message || String(this.state.error)}
            </div>
            <div className="text-[10px] text-rose-300/70 mb-2">
              The inspector is still functional — edit the offending node,
              or use undo to revert.
            </div>
            <button
              type="button"
              onClick={this.handleReset}
              className="text-[11px] rounded border border-rose-700/60 bg-rose-900/40 px-2 py-0.5 text-rose-100 hover:bg-rose-800/40"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default PanelBuilderCanvasErrorBoundary;
