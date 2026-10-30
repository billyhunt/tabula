# Tabula agent instructions

## Ship every change to /Applications

Standing rule from Billy (2026-10-20). After any change to Tabula's code that
passes its checks, run `npm run ship` without being asked. It builds the app,
quits every running copy (a normal quit, which tries to save unsaved drawings
first and can stop at a prompt if a save fails or autosave is off), swaps in
`/Applications/Tabula.app` without deleting the old one until the new copy is
in place, and reopens it. It also quits this repo's `npm run dev` Electron.

- Run it after typecheck and `npm test` pass locally and CI (which runs
  `npm run test:e2e` on macOS) passes on the commit, not before.
- If it reports a copy still running (a save prompt, say), stop and tell Billy.
  Never force-quit Tabula: that can lose an unsaved drawing.
- Doc-only changes don't need a ship.

## Leave the end-to-end suite to CI

Standing rule from Billy (2026-10-30). `npm run test:e2e` opens real app
windows that grab focus, and on Billy's Mac it locks up the desktop he is
working at. Agents do not run it locally:

- Locally, run `npm run typecheck` and `npm test`. CI runs the suite on macOS
  for every pull request and every push to `main` (not for a branch without
  a pull request): push to a branch with an open pull request and read its
  result there.
- Run one end-to-end test locally only to debug a failure CI cannot explain,
  with `npm run build && npx playwright test -g "<name>"`, never the whole
  suite.
- `npm run demo` opens a real window too; run it only when Billy asks.
- No throwaway scripts or probes that open Electron windows on screen. Use
  `show: false` or offscreen windows.
- Every local suite run, and the demo, first waits for the desktop-test lock
  (`e2e/desktopLock.mjs`: port 47390 on 127.0.0.1, shared with Alethia), so
  two never run at once.
