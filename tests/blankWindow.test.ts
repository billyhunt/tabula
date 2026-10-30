import { describe, expect, it } from 'vitest'
import { makeBlankWindow, type BlankWindowDeps } from '../src/main/agent/blankWindow'

interface FakeWindow {
  name: string
  closed: boolean
  isDestroyed(): boolean
  close(): void
}

const fakeWindow = (name: string): FakeWindow => {
  const win: FakeWindow = { name, closed: false, isDestroyed: () => win.closed, close: () => (win.closed = true) }
  return win
}

/** Deps around a current window; each can be overridden. */
const setup = (overrides: Partial<BlankWindowDeps<FakeWindow>> = {}) => {
  const current = fakeWindow('current')
  const made: FakeWindow[] = []
  const asked: string[] = []
  const deps: BlankWindowDeps<FakeWindow> = {
    current: async () => current,
    create: () => {
      const win = fakeWindow(`new${made.length + 1}`)
      made.push(win)
      return win
    },
    editorReady: async () => undefined,
    hasPendingFile: () => false,
    isBlank: async (win) => {
      asked.push(win.name)
      return true
    },
    ...overrides,
  }
  return { current, made, asked, blank: makeBlankWindow(deps) }
}

describe('makeBlankWindow', () => {
  it('reuses the current window while it is blank', async () => {
    const { current, made, blank } = setup()
    const slot = await blank()
    expect(slot).toEqual({ win: current, created: false })
    expect(made).toHaveLength(0)
  })

  it('opens a new window when the current one has a drawing', async () => {
    const { made, blank } = setup({ isBlank: async () => false })
    const slot = await blank()
    expect(slot.created).toBe(true)
    expect(slot.win).toBe(made[0])
  })

  it('opens a new window rather than take one still waiting for its Finder file', async () => {
    const { made, asked, blank } = setup({ hasPendingFile: () => true })
    const slot = await blank()
    expect(slot.created).toBe(true)
    expect(made).toHaveLength(1)
    // It looks blank, so the answer must not even be asked for.
    expect(asked).toEqual([])
  })

  it('treats a window that cannot say whether it is blank as occupied', async () => {
    const { made, blank } = setup({
      isBlank: async () => {
        throw new Error('timed out')
      },
    })
    expect((await blank()).created).toBe(true)
    expect(made).toHaveLength(1)
  })

  it('always opens a window with fresh, without asking the current one', async () => {
    const { made, asked, blank } = setup()
    expect((await blank({ fresh: true })).created).toBe(true)
    expect(made).toHaveLength(1)
    expect(asked).toEqual([])
  })

  it('closes a window whose editor never came up, and reports why', async () => {
    const { made, blank } = setup({
      isBlank: async () => false,
      editorReady: async () => {
        throw new Error('editor never answered')
      },
    })
    await expect(blank()).rejects.toThrow('editor never answered')
    expect(made).toHaveLength(1)
    expect(made[0].closed).toBe(true)
  })
})
