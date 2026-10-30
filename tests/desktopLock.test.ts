import { spawn } from 'node:child_process'
import { once } from 'node:events'
import net from 'node:net'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { acquireDesktopLock } from '../e2e/desktopLock.mjs'

// Each test uses a port of its own, so none touches the real lock.
const freePort = async () => {
  const server = net.createServer().listen({ host: '127.0.0.1', port: 0 })
  await once(server, 'listening')
  const { port } = server.address() as net.AddressInfo
  server.close()
  await once(server, 'close')
  return port
}

const cleanups: (() => unknown)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

/** Takes the lock on `port`; `waiting` resolves with the first "Waiting for…" message. */
const lock = (port: number, suite: string, waitMs = 10_000) => {
  const told = Promise.withResolvers<string>()
  const acquired = acquireDesktopLock({ suite, port, waitMs, pollMs: 20, log: (m: string) => told.resolve(m) })
  return { acquired, waiting: told.promise }
}

describe('desktop lock', () => {
  it('makes a second run wait for the first, and says whose run it is waiting for', async () => {
    const port = await freePort()
    const releaseFirst = await lock(port, 'first').acquired
    let secondGotIt = false
    const second = lock(port, 'second')
    void second.acquired.then(() => (secondGotIt = true))
    expect(await second.waiting).toBe(`Waiting for the first desktop test run (pid ${process.pid}) to finish…`)
    expect(secondGotIt).toBe(false)
    await releaseFirst()
    cleanups.push(await second.acquired)
  })

  it('is free the moment a holder dies, with nothing left to clean up', async () => {
    const port = await freePort()
    const module = pathToFileURL(path.resolve(import.meta.dirname, '../e2e/desktopLock.mjs')).href
    // A separate process, so it can die holding the lock; it can only load the module at run time.
    const child = spawn(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `const { acquireDesktopLock } = await import(${JSON.stringify(module)})
         await acquireDesktopLock({ suite: 'doomed', port: ${port} })
         console.log('held')
         setInterval(() => {}, 1000)`,
      ],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    )
    cleanups.push(() => child.kill('SIGKILL'))
    await once(child.stdout, 'data')
    const next = lock(port, 'next')
    expect(await next.waiting).toContain(`the doomed desktop test run (pid ${child.pid})`)
    child.kill('SIGKILL')
    cleanups.push(await next.acquired)
  })

  it('gives up after its wait, naming the holder', async () => {
    const port = await freePort()
    cleanups.push(await lock(port, 'slow').acquired)
    await expect(lock(port, 'impatient', 1).acquired).rejects.toThrow(/waiting for the slow desktop test run/)
  })

  it('says so when something else holds the port', async () => {
    const port = await freePort()
    const other = net.createServer((socket) => socket.end('HTTP/1.1 200 OK\r\n\r\n')).listen({ host: '127.0.0.1', port })
    await once(other, 'listening')
    cleanups.push(() => other.close())
    await expect(lock(port, 'blocked', 1).acquired).rejects.toThrow(`another program listening on 127.0.0.1:${port}`)
  })
})
