/**
 * The drawing a window is about to show, kept until its editor reports that
 * file as its title. Until then the window looks empty, so agents must not
 * take it over, and a second open of the same file must find this window
 * instead of making another.
 *
 * A claim ends when the editor reports any file (`release`), says it could not
 * load this one, or main could not read it. There is no expiry: every way a
 * window can stop short of reporting its file ends the claim or hands the
 * file out again, and a reloaded page asks again (`reloaded`).
 *
 * Kept free of Electron so the rules can be tested on their own.
 */
export interface Claims<W extends object> {
  /** A window made to open `file` (from Finder): its editor fetches the file with `take`. */
  expect(win: W, file: string): void
  /** An agent is loading `file` into `win` through the bridge, so the editor is not handed it. */
  loading(win: W, file: string): void
  /** The file the editor should load now, once per page load; undefined if none. */
  take(win: W): string | undefined
  /** The window's page started loading again: a file it has not reported yet is handed out again. */
  reloaded(win: W): void
  release(win: W): void
  /** The file `win` is claimed for, if any. */
  fileOf(win: W): string | undefined
}

export const createClaims = <W extends object>(): Claims<W> => {
  const claims = new WeakMap<W, { file: string; taken: boolean }>()
  return {
    expect: (win, file) => void claims.set(win, { file, taken: false }),
    loading: (win, file) => void claims.set(win, { file, taken: true }),
    take: (win) => {
      const claim = claims.get(win)
      if (!claim || claim.taken) return undefined
      claim.taken = true
      return claim.file
    },
    reloaded: (win) => {
      const claim = claims.get(win)
      if (claim) claim.taken = false
    },
    release: (win) => void claims.delete(win),
    fileOf: (win) => claims.get(win)?.file,
  }
}
