# Tabula

A whiteboard for macOS, built on [Excalidraw](https://github.com/excalidraw/excalidraw)
and saving straight into your Obsidian vault.

Tabula wraps the full Excalidraw editor in a native Mac app. Every tool and
shortcut works as it does on excalidraw.com. Drawings save as Obsidian
Excalidraw plugin files (`.excalidraw.md`), so they sit in a vault next to
your notes and stay searchable and linkable there.

The name is the Roman wax tablet; *tabula rasa* is the blank slate a drawing
starts from. It is a sibling of [Alethia](https://github.com/billyhunt/alethia-markdown-editor),
a markdown editor, and shares its look: paper ground, hard black rules, one
hot orange.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/capabilities-dark.svg">
  <img alt="Diagram of Tabula: drawing by hand, an Obsidian vault, Mermaid text, AI agents over MCP and the Ask bar feed into Tabula, which saves .excalidraw files and exports PNG, SVG, PDF and Mermaid. Below, a gallery of Excalidraw shapes and fill styles." src="docs/capabilities-light.svg">
</picture>

*Drawn in Tabula, and last updated by an agent driving Tabula over MCP. The
source is [`docs/capabilities.excalidraw.md`](docs/capabilities.excalidraw.md):
open it in Tabula, or in Obsidian with the Excalidraw plugin.*

> Tabula is an independent project. It is not affiliated with or endorsed by
> Excalidraw.

## Status

Early alpha. It runs from source on Apple-silicon Macs; there is no signed
release yet.

Working now:

- The full Excalidraw editor, with excalidraw.com's tools and shortcuts
- Open and save `.excalidraw.md` (Obsidian Excalidraw plugin) and `.excalidraw`
- Light and dark mode, following macOS
- Works offline: all fonts are bundled
- Export to PNG, SVG, PDF (one page per frame, if you like) and Mermaid, or
  copy as PNG, SVG or Mermaid; exports cover the selection when there is one
- Mermaid import: File ▸ Import Mermaid…, or paste a Mermaid diagram onto the
  canvas (⇧⌘V pastes it as text)
- A built-in MCP server, so AI agents such as Claude Code can draw on the open
  board (see [Connecting an agent](#connecting-an-agent))
- **Ask** (⌘J): tell Claude what to draw or change, and watch it work on the
  board. With a selection it works on just that ("tidy this up", "turn these
  notes into a flowchart"). Each change is one undo step.
- **Text to diagram** (Agent ▸ Text to Diagram…): describe a diagram, preview
  the Mermaid Claude writes, then insert it
- Autosave for drawings that have a file, and a version history (File ▸
  Browse Versions…) that keeps what every save replaced, with a preview and
  restore

## Claude

Ask and Text to diagram call the Anthropic API with your own key. Tabula
never stores the key: in **Settings** (⌘,), give a 1Password secret reference
such as `op://Private/Anthropic/credential`, and Tabula reads it with the
1Password CLI (`op`) the first time you ask. `ANTHROPIC_API_KEY` in the
environment takes precedence. The model is configurable there too; the
default is `claude-sonnet-5-5`.

## Running it

```bash
npm install
npm run dev
```

`npm run dev` starts Vite and launches Electron against it, with hot reload.

```bash
npm test          # unit tests
npm run test:e2e  # builds, then drives the app with Playwright
npm run package   # unsigned Apple-silicon .app in release/mac-arm64/
```

The end-to-end run uses a throwaway profile and a fake Anthropic API, so it
needs no key. Set `TABULA_E2E_APP` to a packaged app's binary to run it
against the packaged build.

## Connecting an agent

Turn on **Agent ▸ Allow Agent Connections (MCP)** in the menu bar, then copy the
setup command from Settings and run it once:

```bash
claude mcp add --transport http tabula http://127.0.0.1:7337/mcp --header "Authorization: Bearer <token>"
```

The server listens on 127.0.0.1 only, needs that token (kept in Tabula's
app-support folder; Settings can replace it), and refuses requests from web
pages. Agents get the same tools as the Ask bar — read the drawing, add,
change and delete elements, import Mermaid, select, zoom, screenshot — plus
export, open, save and new drawing. Every change is one undo step.

## File format

Tabula's native format is the
[Obsidian Excalidraw plugin](https://github.com/zsviczian/obsidian-excalidraw-plugin)'s
`.excalidraw.md`: a markdown file with the drawing's text pulled out as
searchable text, and the drawing data in a fenced block.

- Tabula writes the drawing data as plain JSON, so files are readable and
  diff well in git. It reads both plain and compressed files.
- Re-saving keeps everything Tabula doesn't own: frontmatter, notes above the
  drawing, element links, embedded files, and `[[wiki links]]` in drawing
  text.
- Plain `.excalidraw` files, as used by excalidraw.com, open too, and save
  back in their own format.

To edit the same drawings in Obsidian, install the Excalidraw plugin there.

## Architecture

| Directory | Runs in | Purpose |
|---|---|---|
| `src/main/` | Electron main | Window, menus, file dialogs, file I/O, version history, PDF printing |
| `src/main/agent/` | Electron main | MCP server, Claude calls (Ask, Text to diagram), API key lookup |
| `src/preload/` | Preload (sandboxed) | The only bridge between page and main |
| `src/renderer/` | Chromium | React shell around the Excalidraw editor |
| `src/renderer/agent/` | Chromium | Canvas tools agents call, Ask bar, Settings |
| `src/renderer/export/`, `mermaid/` | Chromium | Exports, Mermaid writer and import |
| `src/renderer/format/` | Chromium | `.excalidraw.md` reader and writer |
| `src/shared/` | Both | IPC channels and types, the canvas tool schemas |

The scene lives in the page, so both the MCP server and the Ask bar reach it
the same way: main validates a tool call and forwards it to the window, which
runs it against the editor. Paths and file writes stay in main. The packaged
app serves the page from an `app://tabula/` origin rather than `file://`, so
the strict content security policy can allow the bundled fonts.

Excalidraw is used as a library, unmodified. It is pinned to an exact build
of the npm `next` channel, which is what excalidraw.com runs; the `latest`
release still uses number keys for tools.

## License

MIT. See [`LICENSE`](LICENSE).

Tabula bundles Excalidraw (MIT), several fonts (mostly SIL OFL 1.1) and about
380 open-source packages. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
