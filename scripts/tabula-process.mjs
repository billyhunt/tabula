/**
 * Which running processes are Tabula, from `ps`: the process's `comm` (its
 * executable path; just the file name in some column layouts) and its
 * `command` (the executable path, then its arguments). Kept apart from
 * open-app.mjs so it can be tested without touching a live process.
 */

const PACKAGED_PATH = /^\/.*\/Tabula\.app\/Contents\/MacOS\/Tabula$/
// The executable path at the start of a packaged copy's command line, then
// arguments or nothing. Paths may contain spaces, so this alone could also
// match a debugger launched with Tabula's path as an argument; it is only
// used once the process's own name says it is Tabula.
const PACKAGED_COMMAND = /^(\/.*?\/Tabula\.app\/Contents\/MacOS\/Tabula)(?: |$)/

/**
 * The executable a process runs if it is a Tabula main process: a packaged
 * copy anywhere, or, when given, this repo's dev Electron binary. Null for
 * anything else, helpers included (their executables have names of their own).
 */
export const tabulaExecutable = (comm, command, devElectron) => {
  if (comm === undefined) return null
  if (PACKAGED_PATH.test(comm)) return comm
  if (comm === 'Tabula') return PACKAGED_COMMAND.exec(command)?.[1] ?? null
  if (devElectron) {
    if (comm === devElectron) return devElectron
    if (comm === 'Electron' && (command === devElectron || command.startsWith(`${devElectron} `))) return devElectron
  }
  return null
}
