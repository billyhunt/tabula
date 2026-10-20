# Tabula agent instructions

## Ship every change to /Applications

Standing rule from Billy (2026-10-20). After any change to Tabula's code that
passes its checks, run `npm run ship` without being asked. It builds the app,
quits every running copy (a normal quit, which saves unsaved drawings first),
replaces `/Applications/Tabula.app`, and reopens it.

- Run it after typecheck, `npm test` and `npm run test:e2e` pass, not before.
- If it reports a copy still running (a save prompt, say), stop and tell Billy.
  Never force-quit Tabula: that can lose an unsaved drawing.
- Doc-only changes don't need a ship.
