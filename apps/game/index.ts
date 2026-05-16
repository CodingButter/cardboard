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
 *
 * P1 of `docs/plans/PACK_CHAIN.md` §3: the URL accepts multiple
 * `?pack=` params (`?pack=A&pack=B`) treated as an explicit chain in
 * declaration order — the LAST one is the root passed to `Game`,
 * earlier ones become prepended dependencies once the resolver walks
 * their `requires` graphs. A single `?pack=URL` stays as-before.
 */
let previousState: Partial<GameState> | undefined;

if (import.meta.hot && import.meta.hot.data.state) {
  previousState = import.meta.hot.data.state as Partial<GameState>;
}

const params = new URLSearchParams(window.location.search);
const packUrls = params.getAll("pack").filter((u) => u.length > 0);

const game = await main(previousState, packUrls);

if (import.meta.hot) {
  import.meta.hot.dispose((data) => {
    data.state = game.snapshot();
    game.stop();
  });
  import.meta.hot.accept();
}
