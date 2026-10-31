# Handoff

Where Tabula stands, so the next session can pick up without rereading history.
Last updated 2026-10-30.

## State

- `main` is at the merge of PR #9. PRs #1 to #9 are merged:
  - #5: packaged builds carry Electron's licence files.
  - #6: the MCP server starts by default.
  - #7: agents get their own window, exports cover the whole board, and
    `npm run ship` exists.
  - #8: every corner Excalidraw draws is square.
  - #9: the end-to-end suite is left to CI, and local runs (and the demo)
    take a machine-wide lock, port 47390 on 127.0.0.1, shared with Alethia,
    before they build. Billy asked for it after local test runs locked up his
    desktop.
- `/Applications/Tabula.app` was shipped from `6e4eca8` on 2026-10-30. #9
  changed no app code, so nothing newer needs shipping.
- No PRs are open.

## Known gaps

- Installs that have ever changed a setting keep their saved
  `mcpEnabled: false`, because Tabula writes the whole settings object on any
  change. Only installs with no saved setting pick up the new default.
- A Finder open of a file an agent already has open makes a second window:
  Finder's `open-file` does not check `windowOnFile` yet (found in the #7
  review; pre-existing).
- Nothing tests the wiring from `did-start-loading` to the claim store's
  reload rule; the rule itself has unit tests.
- The library e2e test was flaky (sidebar closed); #9 makes it open the
  sidebar itself. Watch for other tests that assume the sidebar is open.

## Connecting an agent other than Claude Code

The server needs `Authorization: Bearer <token>`, with the token in
`mcp-token` in Tabula's app-support folder. Clients that can run a command for a
header value can read it at connect time instead of storing a copy, so
replacing the token in Settings keeps working. Oh My Pi's `mcp.json`:

```json
"tabula": {
  "type": "http",
  "url": "http://127.0.0.1:7337/mcp",
  "headers": {
    "Authorization": "!printf 'Bearer %s' \"$(cat \"$HOME/Library/Application Support/Tabula/mcp-token\")\""
  }
}
```

A request without the token gets 401. With it, `tools/list` returns 12 tools.

## Next

1. Follow-up: Finder opens should reuse a window that already has the file.
2. Follow-up (Alethia): `e2e/opening.spec.ts` "unsaved untitled text is never
   displaced…" failed once in CI and passed on re-run; find the flake.
