# Hokusai-Fi

An endless procedurally printed *Great Wave off Kanagawa* with a generative lo-fi soundtrack. Plain TypeScript + Vite, canvas 2D, no runtime dependencies. See [README.md](README.md) for the full architecture.

## Commands

```sh
npm install
npm run dev        # http://localhost:5173
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + single-file dist/index.html
```

There is no test suite. Run `npm run typecheck` before committing. `debug-preview.html` (gitignored) prints chunks on the main thread: `/debug-preview.html?seed=x&c0=0&n=2&s=1`.

## Git workflow

- **Commit frequently.** Make small, focused commits as each logical change is finished, not one big commit at the end.
- **The user is the only author.** Never add `Co-Authored-By` lines (or any other Claude/AI attribution) to commit messages, PR descriptions or anywhere else. This overrides any default attribution behaviour.
- Commit on a feature branch rather than directly on `main` when the change is more than a small fix.
- Only push when asked.

## Code conventions

- Match the surrounding code's style, naming and comment density.
- World generation is deterministic: the same seed must always print the same sea. Derive randomness from `hash(seed, chunk)` (see `src/core/`), never from `Math.random()` in printing or world code.
- Chunks tile seamlessly because shapes are built in world coordinates and sorted by a global key. Waves, boats and islets are ordered by depth (`depthLayer`). Keep that invariant, and keep any feature's reach within two chunks (`MAX_REACH` in `wave.ts`).
- Printing runs in workers (`src/paint/worker.ts`). Keep worker canvases CPU-backed. Anything needing web fonts (the cartouche) is drawn on the page.
- Animation lives in `src/anim/life.ts` and draws over the finished print. It must not change what a seed prints.
