# Tabula app icon: requirements

## What it has to say

Tabula is a whiteboard for macOS. The name is the Roman wax tablet, and
*tabula rasa* is the blank slate a new drawing starts from. It is Alethia's
sibling: Alethia is the Greek-named markdown editor, Tabula is the
Roman-named drawing board. Side by side in the Dock, they should read as
one family and still be told apart at a glance.

## Family rules (inherited from Alethia)

Alethia's icon
([`build/icon.svg`](https://github.com/billyhunt/alethia-markdown-editor/blob/main/build/icon.svg))
sets the system. Tabula keeps the frame and changes the content.

| Element | Alethia | Tabula |
|---|---|---|
| Canvas | 1024 × 1024 | Same |
| Tile | Full-bleed rounded square, `rx="224"` | Same shape |
| Inner rule | 36 px stroke, inset 64 px, `rx="160"`, `#111111` | Same geometry |
| Palette | Hot orange `#ff3b00`, ink `#111111`, paper `#f2f0eb` | Same three colours, no others |
| Mark | A single glyph: the Greek alpha, in a heavy serif | A single mark, Roman rather than Greek (see below) |
| Style | Flat, hard edges, no gradients, shadows or texture | Same |

**It must differ from Alethia in colour, not only in the mark.** At 16 px the
glyph is a few pixels, so two orange tiles look identical. Make the tile
paper or ink rather than orange, and keep orange as the accent.

## The mark: pick one

1. **Roman capital T** (recommended). An inscriptional, Trajan-style capital
   T with real serifs, the Roman counterpart to Alethia's alpha. It's the
   clearest at small sizes and the most direct sibling.
2. **The tablet.** A wax tablet in plan view: an inner rectangle, as if
   pressed into the tile, with one stylus stroke across it. It says "board"
   without letters, but is harder to read below 32 px.
3. **A hand-drawn stroke.** One Excalidraw-style sketchy rectangle or
   underline in orange on paper. It nods to the drawing engine, but risks
   looking like Excalidraw's own branding.

Suggested starting point: paper tile `#f2f0eb`, ink rule `#111111`, ink
capital T, plus one hot-orange element, such as a short horizontal bar under
the T (the "slate line") or the T's crossbar in orange.

## Hard requirements

- **Glyphs converted to outlines.** Alethia's SVG sets its alpha with a live
  `<text>` element in Times. That depends on the fonts installed where it's
  rendered. Tabula's mark must be paths.
- **Readable at 16 px.** That's the size in Finder lists and the menu bar's
  recent items. Check it at 16, 32 and 64 px before anything else.
- **Inside the macOS mask.** The rule and the mark must sit fully inside the
  64 px inset, corners included. Alethia's border was clipped once and fixed
  in commit `abdabb2`.
- **No words.** No "Tabula" lettering, no Excalidraw logo, and no imagery
  that implies Excalidraw endorses it.
- **Only the three palette colours.** The drawing canvas inverts in dark mode
  but the icon does not, so it must hold up on both a light and a dark Dock.

## Deliverables

All go in `build/`, which electron-builder reads automatically:

| File | Contents |
|---|---|
| `build/icon.svg` | 1024 master: paths only, with `<title>` and `<desc>` |
| `build/icon.png` | 1024 × 1024 render of the master |
| `build/icon.icns` | All ten entries: 16, 32, 128, 256 and 512, each at @1x and @2x |

Keep explorations as `build/tabula-<variant>-icon.svg`/`.png`, the way
Alethia keeps its alternates.

## Done when

- `npm run package` produces an app with `Contents/Resources/icon.icns`
  byte-identical to `build/icon.icns`, and `CFBundleIconFile` points at it.
- The icon is checked in the Dock, Cmd-Tab, Finder in icon and list views,
  and Launchpad, next to Alethia's, in both light and dark appearance.
- The dev app shows it too. That needs a port of Alethia's
  `scripts/brand-dev-electron.mjs` postinstall step, which also renames the
  dev build from "Electron" to "Tabula".

## Out of scope for now

- Document icons for `.excalidraw` and `.excalidraw.md` files in Finder.
- macOS 26 dark, tinted and clear icon variants (Icon Composer `.icon`
  format). Alethia doesn't ship these either; add them to both apps at once.
