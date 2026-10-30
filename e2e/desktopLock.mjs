/**
 * One desktop test run at a time on this Mac.
 *
 * End-to-end suites and the demo recorder open real windows that take focus.
 * Two at once (two agents, or Tabula's and Alethia's suites) fight over focus,
 * fail each other's focus assertions, and leave the desktop unusable for
 * whoever is at it. Every run that uses this file takes the same lock, so a
 * second one waits its turn.
 *
 * The lock is a TCP port on 127.0.0.1: only one process can listen on it, the
 * system frees it the moment its owner exits or dies, and it is the same for
 * every process on the machine, whatever its TMPDIR. So there is no lock file
 * to go stale or be half-written. A waiter connects to learn who holds it.
 *
 * Plain JavaScript so a Node script (the demo recorder) can import it as well
 * as Playwright. Alethia keeps a copy of this file; keep the port in step.
 */
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

export const DESKTOP_LOCK_PORT = 47_390

const HOST = '127.0.0.1'

/** Listens on the lock port; resolves with the server, or null if the port is taken. */
const listen = (port, owner) => {
  const { promise, resolve, reject } = Promise.withResolvers()
  const server = net.createServer((socket) => socket.end(JSON.stringify(owner)))
  server.once('error', (err) => (err.code === 'EADDRINUSE' ? resolve(null) : reject(err)))
  server.listen({ host: HOST, port }, () => resolve(server))
  return promise
}

/** Who holds the lock, as its owner reports it; null if the port's listener is not one of us. */
const holder = async (port) => {
  const { promise, resolve } = Promise.withResolvers()
  let data = ''
  const socket = net.connect({ host: HOST, port })
  socket.setTimeout(2_000, () => socket.destroy())
  socket.on('data', (chunk) => (data += chunk))
  socket.on('close', () => {
    try {
      const owner = JSON.parse(data)
      resolve(typeof owner?.pid === 'number' ? owner : null)
    } catch {
      resolve(null)
    }
  })
  socket.on('error', () => undefined)
  return promise
}

/**
 * Waits until this process holds the desktop lock, then returns a function
 * that releases it. The lock is also released when the process exits.
 */
export const acquireDesktopLock = async ({
  suite,
  port = DESKTOP_LOCK_PORT,
  waitMs = 30 * 60_000,
  pollMs = 1_000,
  log = console.log,
}) => {
  const owner = { pid: process.pid, suite, startedAt: Date.now() }
  const deadline = Date.now() + waitMs
  let told = ''
  for (;;) {
    const server = await listen(port, owner)
    if (server) {
      // Holding the port must not keep a finished process alive.
      server.unref()
      const { promise, resolve } = Promise.withResolvers()
      return () => {
        server.close(() => resolve())
        return promise
      }
    }
    const current = await holder(port)
    const who = current
      ? `the ${current.suite} desktop test run (pid ${current.pid})`
      : `another program listening on 127.0.0.1:${port}`
    if (Date.now() > deadline) throw new Error(`Gave up after ${Math.round(waitMs / 60_000)} min waiting for ${who}.`)
    if (who !== told) {
      log(`Waiting for ${who} to finish…`)
      told = who
    }
    await sleep(pollMs)
  }
}

/** This repo's package name, for the waiting message other runs print. */
const suiteName = () => {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')).name
  } catch {
    return path.basename(process.cwd())
  }
}

/** Playwright global setup: hold the lock for the whole run; teardown releases it. */
export default async function globalSetup() {
  return acquireDesktopLock({ suite: suiteName() })
}
