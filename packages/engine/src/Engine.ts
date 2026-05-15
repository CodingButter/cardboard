/** Callback receiving the time in seconds since the previous frame. */
export type FrameCallback = (deltaTime: number) => void;

/**
 * The game's frame pump.
 *
 * Subscribers register via `onUpdate` (game logic) and `onRender` (drawing).
 * Each tick fires every registered update callback in order, then every render
 * callback in order, so simulation always completes before anything paints.
 *
 * `start()` schedules `requestAnimationFrame`; `stop()` cancels the pending
 * frame and is idempotent.
 */
export default class Engine {
  private lastTime: number = 0;
  private deltaTime: number = 0;
  private rafId: number = 0;
  private isRunning: boolean = false;
  private readonly updateHandlers: FrameCallback[] = [];
  private readonly renderHandlers: FrameCallback[] = [];

  /** Begin the frame loop. No-op if already running. */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  /** Cancel the next scheduled frame. Safe to call when not running. */
  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  /**
   * Subscribe a logic update. Called once per frame, before any render
   * handler, with `deltaTime` in seconds. Returns an unsubscribe function.
   */
  onUpdate(handler: FrameCallback): () => void {
    this.updateHandlers.push(handler);
    return () => {
      const i = this.updateHandlers.indexOf(handler);
      if (i !== -1) this.updateHandlers.splice(i, 1);
    };
  }

  /**
   * Subscribe a render pass. Called once per frame, after every update
   * handler. Returns an unsubscribe function.
   */
  onRender(handler: FrameCallback): () => void {
    this.renderHandlers.push(handler);
    return () => {
      const i = this.renderHandlers.indexOf(handler);
      if (i !== -1) this.renderHandlers.splice(i, 1);
    };
  }

  /** Last computed frame time in seconds. */
  getDeltaTime(): number {
    return this.deltaTime;
  }

  /**
   * Arrow-bound so `requestAnimationFrame(this.tick)` keeps the right `this`
   * without an allocation per frame.
   */
  private tick = (currentTime: number): void => {
    if (!this.isRunning) return;

    this.deltaTime = (currentTime - this.lastTime) / 1000;
    this.lastTime = currentTime;

    for (const handler of this.updateHandlers) handler(this.deltaTime);
    for (const handler of this.renderHandlers) handler(this.deltaTime);

    this.rafId = requestAnimationFrame(this.tick);
  };
}
