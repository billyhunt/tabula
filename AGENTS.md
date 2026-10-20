# Tabula agent instructions

## Ship every change to /Applications

Standing rule from Billy (2026-10-20). After any change to Tabula's code that
passes its checks, run `npm run ship` without being asked. It builds the app,
quits every running copy (a normal quit, which tries to save unsaved drawings
first and can stop at a prompt if a save fails or autosave is off), swaps in
`/Applications/Tabula.app` without deleting the old one until the new copy is
in place, and reopens it. It also quits this repo's `npm run dev` Electron.

- Run it after typecheck, `npm test` and `npm run test:e2e` pass, not before.
- If it reports a copy still running (a save prompt, say), stop and tell Billy.
  Never force-quit Tabula: that can lose an unsaved drawing.
- Doc-only changes don't need a ship.
