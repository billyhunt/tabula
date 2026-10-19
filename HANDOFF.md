# Handoff

Where Tabula stands, so the next session can pick up without rereading history.
Last updated 2026-10-19.

## State

- `main` is at `c2714a0` (e2e clicks kept inside the 677px window CI allows).
  PRs #1 to #4 are merged.
- Two PRs are open. Both pass CI, touch different files, and can merge in
  either order:
  - [#5](https://github.com/billyhunt/tabula/pull/5) Ship Electron's licence
    files from a fresh clone. Electron 44 downloads its binary into
    `node_modules/electron/dist` on first use, not at install, so a clone that
    goes straight to `npm run package` packaged the app without
    `LICENSE.electron.txt` and `LICENSES.chromium.html`. `npm run package` now
    runs `install-electron` first.
  - [#6](https://github.com/billyhunt/tabula/pull/6) Start the MCP server by
    default. The menu toggle still turns it off.

## Known gaps

- Until #5 merges, a packaged build from a fresh clone lacks Electron's licence
  files. A clone where `npm run dev` has already run is fine.
- After #6, installs that have ever changed a setting keep their saved
  `mcpEnabled: false`, because Tabula writes the whole settings object on any
  change. Only installs with no saved setting pick up the new default.

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

1. Review and merge #5 and #6.
2. `npm run package`, then replace the copy in `/Applications` with
   `release/mac-arm64/Tabula.app`.
