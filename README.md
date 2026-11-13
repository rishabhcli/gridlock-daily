# Gridlock Daily

A daily sliding-car puzzle for Reddit, built on Devvit Web. Every UTC day the whole community gets the same 6x6 traffic jam. Slide the cars out of the way and drive the red one out the exit on the right.

Built for Reddit's "Game of the Day" hackathon.

## How to play

- Drag a car along its length. You can also tap a car and use the arrow keys.
- Cars cannot turn, and they cannot jump over each other.
- Sliding one car any distance is one move. Moving the same car again right after it also counts as that same move.
- **Par** is the fewest moves possible, computed by a breadth-first search over every reachable board.
- **Undo** and **Reset** are free. **Hint** shows the next optimal move, but a run that used hints stays off the leaderboard and is labelled "hints used" on the result card.
- When the red car is free it drives off the board, and a result card shows your moves against par, your time, your streak and how everyone else did.

## The daily puzzle

- The puzzle is generated from the UTC date: `mulberry32(fnv1a("gridlock-YYYY-MM-DD"))` seeds a random board generator that is then refined by a hill-climbing search until the optimal solution length (par) falls in that weekday's band.
- Difficulty ramps through the week (par bands): Mon 6-9, Tue 8-11, Wed 10-13, Thu 12-15, Fri 14-18, Sat 16-22, Sun 18-26. If a band cannot be hit within the search budget, the band is widened slightly; the puzzle is always solvable.
- Puzzle #1 is 2026-11-16. The generator lives in `src/shared/puzzle.ts` and is pure TypeScript, so the client and the server produce the identical board for a date.
- Every posted puzzle is tied to its own day (stored in the post data), so an older daily post still shows its own puzzle and its own leaderboard.

## Leaderboard and streaks

- When you solve, the client sends the list of moves. The server replays them on its own copy of the puzzle and rejects anything that is not a legal sequence that ends with the red car at the exit. The move count is therefore server-verified.
- Ranking is fewest moves, then fastest time. The time is reported by the client, so it is not tamper-proof; the move count is.
- Your best result per day is kept. Runs with hints are saved (and count for the streak) but are not ranked.
- Streak: solving today's puzzle on its UTC day extends your streak if you also solved yesterday's, otherwise it restarts at 1. Solving an older puzzle never changes the streak.
- Logged-out players can play, but nothing is stored. The game shows a prompt to log in.

## Reddit features used

- **Devvit Web custom post** with an inline splash entry (`splash.html`, plain DOM, a tiny CSS board preview, today's puzzle number, streak and solve count) and an expanded game entry (`game.html`) opened with `requestExpandedMode`.
- **Redis**: sorted set for the daily leaderboard, hashes for per-user results and the move-count histogram, per-user streak, cached puzzle JSON and a "posted" key per day.
- **Scheduler**: a cron task (`5 0 * * *`) creates "Gridlock Daily #N" every day at 00:05 UTC. A Redis key per day prevents duplicate posts.
- **Triggers and menu**: `onAppInstall` posts today's puzzle; the subreddit menu item "Create a new post" lets moderators post one on demand.
- **Text fallback** for old.reddit and clients that cannot render the web view.
- **Client helpers**: `showToast`, `showShareSheet`, `showLoginPrompt` from `@devvit/web/client`.
- **User actions**: an optional "Share as comment" button posts your result as a comment from your own account (`reddit.submitComment` with `runAs: 'USER'`). It requires an explicit second tap to confirm, nothing is ever posted automatically, and the game is fully playable without it. Copy and Share are the default ways to share.

## Accessibility and polish

- Light and dark themes follow the system setting, with flat-gradient cars drawn entirely in CSS.
- Cars are keyboard focusable buttons with descriptive labels, results and hints are announced through live regions, and `prefers-reduced-motion` turns animations off.
- No external network calls, fonts or third-party assets.

## Project layout

```
src/shared/puzzle.ts   generator, BFS solver, move replay, streak and share-text logic (pure TS)
src/shared/api.ts      request and response types
src/server/            Hono routes: /api/today, /api/submit, /api/leaderboard, /api/share-comment,
                       menu, onAppInstall trigger and the daily scheduler task
src/client/            splash.ts (inline entry), game.tsx + Board.tsx (expanded game), CSS
tools/build.mjs        build script (esbuild-wasm, no native binaries)
tools/preview.mjs      local preview server with an in-memory API stub
devvit.json            Devvit app config
```

## Commands

```
npm install
npm run test:types   # tsc for client and server
npm run test:unit    # node:test: determinism, solvability and par for 200 days, replay validator, streaks
npm run build        # dist/client/{splash,game}.html + dist/server/index.cjs
npm run preview      # build, then serve http://localhost:5173/game.html with a stubbed API
npx devvit playtest  # run the app on a test subreddit
npx devvit upload    # upload a version
```

The build uses `esbuild-wasm` instead of Vite so it runs on machines that block unsigned native binaries. `devvit.json` points `scripts.build` and `scripts.dev` at `tools/build.mjs`.

The preview server (`tools/preview.mjs`) is for local testing only. It seeds a few clearly named demo players (`demo_*`) so the leaderboard and histogram have content; the real app never fabricates players.

## How it was built

Gridlock Daily was built by Rishabh Bansal with AI coding assistance (Claude Code) and the Devvit documentation. The puzzle generator, solver, server routes and client were written and tested in this repository.

## License

BSD-3-Clause. See `LICENSE`.
