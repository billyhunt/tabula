/**
 * Playwright global setup: one desktop test suite at a time on this Mac.
 *
 * End-to-end suites launch real windows that take focus. Two suites at once
 * (two agents, or Alethia's and Tabula's) fight over focus, fail each other's
 * focus assertions, and leave the desktop unusable for whoever is at it. Every
 * suite that uses this file shares one lock, so a second run waits its turn.
 *
 * The lock is a directory (mkdir is atomic) holding the owner's pid. A lock
 * whose owner has died, or that is older than STALE_MS, is taken over.
 * Alethia keeps a copy of this file; keep the lock path in step.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const LOCK = path.join(os.tmpdir(), 'desktop-e2e.lock')
const OWNER = path.join(LOCK, 'owner.json')
const STALE_MS = 2 * 60 * 60 * 1000
const WAIT_MS = 30 * 60 * 1000
const POLL_MS = 1000

interface Owner {
  pid: number
  suite: string
  startedAt: number
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM: the process exists but belongs to someone else.
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

const readOwner = (): Owner | null => {
  try {
    return JSON.parse(fs.readFileSync(OWNER, 'utf8')) as Owner
  } catch {
    return null
  }
}

const tryTake = (suite: string) => {
  try {
    fs.mkdirSync(LOCK)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw err
  }
  const owner: Owner = { pid: process.pid, suite, startedAt: Date.now() }
  fs.writeFileSync(OWNER, JSON.stringify(owner))
  return true
}

const release = () => {
  if (readOwner()?.pid === process.pid) fs.rmSync(LOCK, { recursive: true, force: true })
}

export default async function globalSetup(): Promise<() => void> {
  const suite = path.basename(process.cwd())
  const deadline = Date.now() + WAIT_MS
  let announced = false
  while (!tryTake(suite)) {
    const owner = readOwner()
    // A lock with no owner file yet is being taken right now; give it a beat.
    const stale = owner && (!alive(owner.pid) || Date.now() - owner.startedAt > STALE_MS)
    if (stale) {
      fs.rmSync(LOCK, { recursive: true, force: true })
      continue
    }
    if (Date.now() > deadline) {
      throw new Error(`Gave up after ${WAIT_MS / 60_000} min waiting for another desktop test run (${LOCK}).`)
    }
    if (!announced && owner) {
      console.log(`Waiting for the ${owner.suite} end-to-end run (pid ${owner.pid}) to finish…`)
      announced = true
    }
    await sleep(POLL_MS)
  }
  // Teardown is skipped when a run is interrupted; Playwright still exits
  // normally after closing its windows, so release on exit too. A run killed
  // outright leaves a lock whose owner is dead, which the next run takes over.
  process.once('exit', release)
  return release
}
