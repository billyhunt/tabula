#!/usr/bin/env node
/**
 * Opens the newest packaged Tabula, so the copy you use is always the one
 * just built.
 *
 * Builds land in release/ (`npm run package`) and sometimes release-next/
 * (test builds). Both are the same app to macOS, so whichever was launched
 * first keeps answering the Dock and Finder. This picks the most recently
 * built of the two, quits any copy that is running something older (another
 * folder, or this one from before the rebuild), and opens it.
 *
 * With `--install` (`npm run ship`) it instead replaces /Applications/Tabula.app
 * with that build, after quitting every running copy, and opens the installed
 * one.
 *
 * Quitting uses SIGTERM, which Electron turns into a normal quit: current
 * builds save unsaved drawings before they exit (see main/windows.ts). If a
 * copy is still running after the wait (a "couldn't save" prompt, say), this
 * stops rather than force it, and nothing is replaced.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { replaceApp } from './replace-app.mjs'
import { tabulaExecutable } from './tabula-process.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BUILD_DIRS = ['release', 'release-next']
const INSTALLED = '/Applications/Tabula.app'
const QUIT_WAIT_MS = 30_000
// `npm run dev` runs this branded Electron binary, with arguments.
const DEV_ELECTRON = path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
const install = process.argv.includes('--install')

// Nothing to open on other platforms, or headless (CI) where packaging must
// not quit or launch anything. `--install` is an explicit request, so it runs
// anyway: agent shells often export CI=true.
if (process.platform !== 'darwin' || (process.env.CI && !install)) process.exit(0)

const builds = BUILD_DIRS.map((dir) => path.join(root, dir, 'mac-arm64', 'Tabula.app'))
  .filter((app) => existsSync(path.join(app, 'Contents', 'Resources', 'app.asar')))
  .map((app) => ({
    app,
    builtAt: statSync(path.join(app, 'Contents', 'Resources', 'app.asar')).mtimeMs,
  }))
  .sort((a, b) => b.builtAt - a.builtAt)

const newest = builds[0]
if (!newest) {
  console.error('No packaged Tabula found. Run `npm run package` first.')
  process.exit(1)
}
const target = install ? INSTALLED : newest.app
const targetExecutable = path.join(target, 'Contents', 'MacOS', 'Tabula')

const ps = (columns) => execFileSync('ps', ['-axo', columns], { encoding: 'utf8' }).split('\n')

/** Every Tabula running, wherever it lives, with when it started. */
const running = () => {
  // Names come from a column of their own: a name can have spaces, so it
  // cannot share a line with the command that follows it.
  const names = new Map(
    ps('pid=,comm=')
      .map((line) => /^\s*(\d+)\s+(.*)$/.exec(line))
      .filter(Boolean)
      .map((match) => [Number(match[1]), match[2]]),
  )
  return ps('pid=,lstart=,command=')
    .map((line) => /^\s*(\d+)\s+(\w{3} \w{3}\s+\d+ [\d:]+ \d{4})\s+(.*)$/.exec(line))
    .filter(Boolean)
    .map((match) => ({
      pid: Number(match[1]),
      startedAt: Date.parse(match[2]),
      // With --install this repo's dev Electron counts too: it is Tabula.
      executable: tabulaExecutable(names.get(Number(match[1])), match[3], install ? DEV_ELECTRON : undefined),
    }))
    .filter((p) => p.executable)
}

const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// ps reports whole seconds; a copy started in the build's own second is current.
// Installing replaces files under the running app, so every copy goes first.
const stale = running().filter(
  (p) =>
    install ||
    p.executable !== targetExecutable ||
    p.startedAt < Math.floor(newest.builtAt / 1000) * 1000,
)
for (const { pid, executable } of stale) {
  console.log(`Quitting the copy at ${path.relative(root, executable)}…`)
  process.kill(pid, 'SIGTERM')
}
const deadline = Date.now() + QUIT_WAIT_MS
while (stale.some(({ pid }) => alive(pid))) {
  if (Date.now() > deadline) {
    console.error('Another copy of Tabula is still running (it may be asking about a save). Quit it, then run again.')
    process.exit(1)
  }
  await new Promise((resolve) => setTimeout(resolve, 200))
}

if (install) {
  console.log(`Replacing ${INSTALLED} with ${path.relative(root, newest.app)}`)
  replaceApp(newest.app, INSTALLED)
}

console.log(`Opening ${install ? INSTALLED : path.relative(root, newest.app)}`)
execFileSync('open', [target])
