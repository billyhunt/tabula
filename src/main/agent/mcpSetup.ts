/**
 * The command that registers Tabula with Claude Code. Kept free of Electron
 * so it can be tested on its own.
 *
 * It adds Tabula at user scope, so every project sees it (Claude Code's
 * default, local, covers one folder or git repository only). First it removes
 * this folder's local `tabula` entry, which would otherwise override the new
 * one here, and the user-scope entry, since `claude mcp add` refuses a name it
 * already has. Local entries in other folders are out of its reach.
 */
export const setupCommandFor = (url: string, token: string): string =>
  'claude mcp remove --scope local tabula >/dev/null 2>&1; ' +
  'claude mcp remove --scope user tabula >/dev/null 2>&1; ' +
  `claude mcp add --scope user --transport http tabula ${url} --header "Authorization: Bearer ${token}"`
