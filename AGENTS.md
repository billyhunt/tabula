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

- Locally, run `npm run typecheck` and `npm test`. Push, and let CI run the
  suite; read its result.
- Run one end-to-end test locally only to debug a failure CI cannot explain,
  with `npx playwright test -g "<name>"`, never the whole suite.
- No throwaway scripts or probes that open Electron windows on screen. Use
  `show: false` or offscreen windows.
- Any local run waits for the machine-wide desktop-test lock
  (`e2e/desktopLock.ts`), shared with Alethia, so two suites never run at once.
