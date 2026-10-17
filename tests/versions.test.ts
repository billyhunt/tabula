import { describe, expect, it, vi } from 'vitest'
import { MAX_VERSIONS_PER_FILE, versionsToPrune } from '../src/main/versions'
import type { DrawingVersion } from '../src/shared/ipc'

// versions.ts reads userData through Electron's app, which only exists inside
// Electron; the pruning rule under test never touches it. (vi.mock is hoisted
// above the imports.)
vi.mock('electron', () => ({ app: {}, ipcMain: {} }))

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
// On an hour and day boundary, so bucket edges are easy to reason about.
const NOW = Date.UTC(2026, 9, 17, 12)

const version = (savedAt: number): DrawingVersion => ({
  id: `${savedAt}-0000abcd.snapshot`,
  savedAt,
  hash: '0000abcd',
  bytes: 100,
})

const survivors = (versions: DrawingVersion[]) => {
  const doomed = new Set(versionsToPrune(versions, NOW).map((v) => v.id))
  return versions.filter((v) => !doomed.has(v.id)).map((v) => v.savedAt)
}

describe('versionsToPrune', () => {
  it('keeps every version from the last hour', () => {
    const recent = Array.from({ length: 60 }, (_, i) => version(NOW - i * MINUTE))
    expect(versionsToPrune(recent, NOW)).toEqual([])
  })

  it('keeps the newest version of each hour within the last day', () => {
    // 2h and 3h ago each have three versions inside the same clock hour.
    const twoHours = NOW - 2 * HOUR
    const threeHours = NOW - 3 * HOUR
    const versions = [
      version(twoHours + 50 * MINUTE),
      version(twoHours + 20 * MINUTE),
      version(twoHours + 1 * MINUTE),
      version(threeHours + 40 * MINUTE),
      version(threeHours + 30 * MINUTE),
      version(threeHours),
    ]
    expect(survivors(versions)).toEqual([twoHours + 50 * MINUTE, threeHours + 40 * MINUTE])
  })

  it('keeps the newest version of each day beyond the last day', () => {
    // Midnight three and five days back.
    const threeDays = NOW - 3 * DAY - 12 * HOUR
    const fiveDays = NOW - 5 * DAY - 12 * HOUR
    const versions = [
      version(threeDays + 20 * HOUR),
      version(threeDays + 6 * HOUR),
      version(threeDays),
      version(fiveDays + 2 * HOUR),
      version(fiveDays),
    ]
    expect(survivors(versions)).toEqual([threeDays + 20 * HOUR, fiveDays + 2 * HOUR])
  })

  it('picks keepers by recency regardless of input order', () => {
    const base = NOW - 5 * HOUR
    const versions = [version(base + 10 * MINUTE), version(base + 40 * MINUTE)]
    expect(survivors(versions)).toEqual([base + 40 * MINUTE])
  })

  it('caps the history at the newest versions', () => {
    const extra = 7
    const versions = Array.from({ length: MAX_VERSIONS_PER_FILE + extra }, (_, i) =>
      version(NOW - i * 1000),
    )
    const doomed = versionsToPrune(versions, NOW)
    expect(doomed).toHaveLength(extra)
    expect(doomed.map((v) => v.savedAt)).toEqual(versions.slice(-extra).map((v) => v.savedAt))
  })

  it('applies the cap to what survives thinning, not to the raw list', () => {
    // Under the cap once thinned, but the 3h keeper sits past position 500
    // in the raw list, behind the many versions thinning drops.
    const recent = Array.from({ length: MAX_VERSIONS_PER_FILE - 5 }, (_, i) =>
      version(NOW - i * 1000),
    )
    // Fifty versions a second apart, mid-way through a clock hour.
    const hourBack = (hours: number) =>
      Array.from({ length: 50 }, (_, i) => version(NOW - hours * HOUR + 30 * MINUTE - i * 1000))
    const twoHours = hourBack(2)
    const threeHours = hourBack(3)
    const kept = survivors([...recent, ...twoHours, ...threeHours])
    expect(kept).toEqual([
      ...recent.map((v) => v.savedAt),
      twoHours[0].savedAt,
      threeHours[0].savedAt,
    ])
  })
})
