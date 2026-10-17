# Third-party notices

Tabula is built on [Excalidraw](https://github.com/excalidraw/excalidraw) and
bundles the software and fonts below. Every copy of Tabula, including the
packaged `.app`, carries this file and the `licenses/` folder.

## Excalidraw — MIT

Tabula embeds the Excalidraw editor unmodified, as the npm package
`@excalidraw/excalidraw` and its `@excalidraw/*` siblings.

> Copyright (c) 2020 Excalidraw

The npm package ships without a licence file, so the upstream text is kept in
[`licenses/MIT-excalidraw.txt`](licenses/MIT-excalidraw.txt).

## Fonts

All fonts are bundled in the app and loaded locally, never fetched, so their
licences apply to every copy. They are shipped unmodified.

| Font | Used for | Copyright | Licence |
|---|---|---|---|
| Archivo | Interface | 2020 The Archivo Project Authors | [OFL-1.1](licenses/OFL-archivo.txt) |
| Archivo Black | Interface | 2017 The Archivo Black Project Authors | [OFL-1.1](licenses/OFL-archivo-black.txt) |
| DM Mono | Interface | 2020 The DM Mono Project Authors | [OFL-1.1](licenses/OFL-dm-mono.txt) |
| Excalifont | Drawing text | Excalidraw | OFL-1.1 ([announcement](https://plus.excalidraw.com/excalifont); no standalone licence file is published, see [the OFL text](licenses/OFL-1.1.txt)) |
| Virgil | Drawing text | 2021 Ellinor Rapp | [OFL-1.1](licenses/OFL-virgil.txt) |
| Cascadia Code | Drawing text (code) | 2019 Microsoft Corporation | [OFL-1.1](licenses/OFL-cascadia-code.txt) |
| Comic Shanns | Drawing text | 2018 Shannon Miwa | [MIT](licenses/MIT-comic-shanns.txt) |
| Liberation Sans | Drawing text | 2012 Red Hat, Inc.; 2010 Google Corporation | [OFL-1.1](licenses/OFL-liberation.txt) |
| Lilita One | Drawing text | 2011 Juan Montoreano | [OFL-1.1](licenses/OFL-lilita-one.txt) |
| Nunito | Drawing text | 2014 The Nunito Project Authors | [OFL-1.1](licenses/OFL-nunito.txt) |
| Assistant | Excalidraw interface | 2020 The Assistant Project Authors; 2010 The Source Sans Pro Authors | [OFL-1.1](licenses/OFL-assistant.txt) |
| Xiaolai | Drawing text (CJK) | 2020–2024 LXGW; 2014 Nozomi Seto | [OFL-1.1](licenses/OFL-xiaolai.txt) |

Under the OFL the fonts may be bundled and redistributed, including
commercially, provided the licence and copyright notices travel with them and
the fonts are not sold on their own.

## Libraries

Excalidraw and Tabula pull in about 290 runtime packages: mostly MIT, plus
ISC, BSD-3-Clause, Apache-2.0, CC0-1.0, 0BSD, Unlicense and
MPL-2.0/Apache-2.0. Their full licence texts and NOTICE files are collected
into `licenses/THIRD_PARTY_LICENSES.txt` by `scripts/collect-licenses.mjs`,
which runs before every package build and fails if any bundled package lacks
a licence text.

## Electron and Chromium

Tabula runs on [Electron](https://electronjs.org) (MIT), which embeds
Chromium and Node.js. Electron's licence and Chromium's licence plus its
third-party notices are copied into the app as
`Contents/Resources/LICENSE.electron.txt` and
`Contents/Resources/LICENSES.chromium.html`.
