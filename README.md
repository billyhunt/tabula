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

Planned:

- Export to PNG, SVG, PDF and Mermaid
- Mermaid import
- A built-in MCP server, so AI agents such as Claude Code can draw on the open board
- An AI prompt bar for creating and editing diagrams

## Running it

```bash
npm install
npm run dev
```

`npm run dev` starts Vite and launches Electron against it, with hot reload.

```bash
npm test          # unit tests
npm run package   # unsigned Apple-silicon .app in release/mac-arm64/
```

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
| `src/main/` | Electron main | Window, menus, file dialogs and file I/O |
| `src/preload/` | Preload (sandboxed) | The only bridge between page and main |
| `src/renderer/` | Chromium | React shell around the Excalidraw editor |
| `src/renderer/format/` | Chromium | `.excalidraw.md` reader and writer |
| `src/shared/` | Both | IPC channel names and types |

Excalidraw is used as a library, unmodified. It is pinned to an exact build
of the npm `next` channel, which is what excalidraw.com runs; the `latest`
release still uses number keys for tools.

## License

MIT. See [`LICENSE`](LICENSE).

Tabula bundles Excalidraw (MIT), several fonts (mostly SIL OFL 1.1) and about
290 open-source packages. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
