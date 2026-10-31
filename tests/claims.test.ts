import { describe, expect, it } from 'vitest'
import { createClaims } from '../src/main/claims'

const win = () => ({})

describe('window claims', () => {
  it('hands a Finder file to the editor once per page load', () => {
    const claims = createClaims()
    const w = win()
    claims.expect(w, '/a.excalidraw')
    expect(claims.take(w)).toBe('/a.excalidraw')
    // A second ask on the same page (React running the effect twice) gets nothing.
    expect(claims.take(w)).toBeUndefined()
    // The claim stands until the editor reports the file.
    expect(claims.fileOf(w)).toBe('/a.excalidraw')
  })

  it('hands the file out again when the page reloads before reporting it', () => {
    const claims = createClaims()
    const w = win()
    claims.expect(w, '/a.excalidraw')
    claims.take(w)
    claims.reloaded(w)
    expect(claims.take(w)).toBe('/a.excalidraw')
  })

  it('does not hand out a file an agent is loading, unless the page reloads mid-load', () => {
    const claims = createClaims()
    const w = win()
    claims.loading(w, '/b.excalidraw.md')
    expect(claims.take(w)).toBeUndefined()
    expect(claims.fileOf(w)).toBe('/b.excalidraw.md')
    claims.reloaded(w)
    expect(claims.take(w)).toBe('/b.excalidraw.md')
  })

  it('ends a claim on release, and a reload then has nothing to hand out', () => {
    const claims = createClaims()
    const w = win()
    claims.expect(w, '/a.excalidraw')
    claims.release(w)
    claims.reloaded(w)
    expect(claims.fileOf(w)).toBeUndefined()
    expect(claims.take(w)).toBeUndefined()
  })

  it('keeps each window to its own claim', () => {
    const claims = createClaims()
    const [a, b] = [win(), win()]
    claims.expect(a, '/a.excalidraw')
    expect(claims.take(b)).toBeUndefined()
    expect(claims.fileOf(b)).toBeUndefined()
  })
})
