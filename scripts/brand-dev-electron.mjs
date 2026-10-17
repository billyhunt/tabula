#!/usr/bin/env node
/**
 * Makes the development app present itself as Tabula.
 *
 * `npm run dev` launches node_modules/electron/dist/Electron.app, and macOS
 * reads that bundle's Info.plist before any of our code runs. The menu-bar
 * title, the Cmd-Tab entry and the Dock icon are therefore settled before
 * app.setName() or the menu template can have any say -- which is why the
 * development app otherwise calls itself "Electron".
 *
 * The only way to change them is to patch that bundle, so this rewrites its
 * name and, once build/icon.icns exists, swaps in our icon. It runs from
 * postinstall because `npm install` replaces the bundle and undoes the patch.
 *
 * Packaged builds need none of this: electron-builder writes the real
 * Info.plist and icon itself.
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, utimesSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bundle = path.join(root, 'node_modules', 'electron', 'dist', 'Electron.app')
const plist = path.join(bundle, 'Contents', 'Info.plist')
const icon = path.join(root, 'build', 'icon.icns')
const bundledIcon = path.join(bundle, 'Contents', 'Resources', 'electron.icns')

// Not a macOS checkout, or dependencies are not installed yet: nothing to do.
if (process.platform !== 'darwin' || !existsSync(plist)) process.exit(0)

const set = (key, value) => {
  try {
    execFileSync('plutil', ['-replace', key, '-string', value, plist], { stdio: 'ignore' })
  } catch {
    // A plist we cannot write is not worth failing an install over.
  }
}

set('CFBundleName', 'Tabula')
set('CFBundleDisplayName', 'Tabula')

if (existsSync(icon)) {
  try {
    copyFileSync(icon, bundledIcon)
  } catch {
    /* ignore */
  }
}

// The icon is cached against the bundle's mtime, so an unchanged timestamp
// leaves the old artwork on screen.
try {
  const now = new Date()
  utimesSync(bundle, now, now)
} catch {
  /* ignore */
}

console.log('branded the development Electron bundle as Tabula')
