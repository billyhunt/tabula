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
 * Quitting uses SIGTERM, which Electron turns into a normal quit: current
 * builds save unsaved drawings before they exit (see main/windows.ts). If a
 * copy is still running after the wait (a "couldn't save" prompt, say), this
 * stops rather than force it.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BUILD_DIRS = ['release', 'release-next']
const QUIT_WAIT_MS = 30_000
const EXECUTABLE = 'Tabula.app/Contents/MacOS/Tabula'

if (process.platform !== 'darwin') process.exit(0)

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
const newestExecutable = path.join(newest.app, 'Contents', 'MacOS', 'Tabula')

/** Every packaged Tabula running, wherever it lives, with when it started. */
const running = () =>
  execFileSync('ps', ['-axo', 'pid=,lstart=,command='], { encoding: 'utf8' })
    .split('\n')
    .map((line) => /^\s*(\d+)\s+(\w{3} \w{3}\s+\d+ [\d:]+ \d{4})\s+(.*)$/.exec(line))
    .filter((match) => match?.[3].endsWith(EXECUTABLE))
    .map((match) => ({
      pid: Number(match[1]),
      startedAt: Date.parse(match[2]),
      executable: match[3],
    }))

const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// ps reports whole seconds; a copy started in the build's own second is current.
const stale = running().filter(
  (p) => p.executable !== newestExecutable || p.startedAt < Math.floor(newest.builtAt / 1000) * 1000,
)
for (const { pid, executable } of stale) {
  console.log(`Quitting the older copy at ${path.relative(root, executable)}…`)
  process.kill(pid, 'SIGTERM')
}
const deadline = Date.now() + QUIT_WAIT_MS
while (stale.some(({ pid }) => alive(pid))) {
  if (Date.now() > deadline) {
    console.error('Another copy of Tabula is still running (it may be asking about a save). Quit it, then run `npm run open`.')
    process.exit(1)
  }
  await new Promise((resolve) => setTimeout(resolve, 200))
}

console.log(`Opening ${path.relative(root, newest.app)}`)
execFileSync('open', [newest.app])
