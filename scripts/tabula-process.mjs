/**
 * Which running processes are Tabula, from `ps -o command=` lines (the
 * executable path, then its arguments). Kept apart from open-app.mjs so it can
 * be tested without touching a live process.
 */

// A packaged copy's main process: an absolute path ending in the bundle's
// executable, then arguments or nothing. Helpers live under Frameworks/ with
// their own names, so they never match. Paths may contain spaces.
const PACKAGED = /^(\/.*?\/Tabula\.app\/Contents\/MacOS\/Tabula)(?: |$)/

/**
 * The executable a `ps` command line runs if it is a Tabula main process: a
 * packaged copy anywhere, or, when given, this repo's dev Electron binary.
 * Null for anything else.
 */
export const tabulaExecutable = (command, devElectron) => {
  const packaged = PACKAGED.exec(command)
  if (packaged) return packaged[1]
  if (devElectron && (command === devElectron || command.startsWith(`${devElectron} `))) return devElectron
  return null
}
