# Progress (all milestones done)
- shared logic + tests, server, client, build, preview, README complete
- Commands (prefix with `export DEVVIT_DISABLE_METRICS=1 PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH`):
  npm run test:types | npm run test:unit | npm run build | npm run preview | npx devvit playtest
- Playtest verified: r/gridlock_daily_dev (v0.0.1.4)
- Known gaps: no visual browser QA done by lane (jsdom smoke only); drag gestures untested outside a real browser.
