import { main, type GameState } from "@two_5_d/engine";

/**
 * HMR-aware bootstrap.
 *
 * Each module reload disposes the previous `Game` (cancelling the engine,
 * detaching input listeners) and starts a new one — but the previous
 * state snapshot is handed forward so the player stays in place.
 *
 * `main()` is async now (it awaits the asset pack download); the
 * top-level `await` is supported in ES modules and Bun's bundler.
 */
let previousState: Partial<GameState> | undefined;

if (import.meta.hot && import.meta.hot.data.state) {
  previousState = import.meta.hot.data.state as Partial<GameState>;
}

const game = await main(previousState);

if (import.meta.hot) {
  import.meta.hot.dispose((data) => {
    data.state = game.snapshot();
    game.stop();
  });
  import.meta.hot.accept();
}
