import { execFileSync } from 'node:child_process'
import { existsSync, renameSync, rmSync } from 'node:fs'

const remove = (target) => rmSync(target, { recursive: true, force: true })

/**
 * Puts a copy of the app at `source` in place of `installed`. The copy is made
 * beside it and swapped in with renames, so a copy that fails (a full disk,
 * say) leaves `installed` as it was, and so does a failed second rename.
 */
export const replaceApp = (source, installed) => {
  const staged = `${installed}.new`
  const backup = `${installed}.old`
  // An earlier run that died between its two renames left only the backup.
  if (!existsSync(installed) && existsSync(backup)) renameSync(backup, installed)
  remove(staged)
  remove(backup)
  try {
    execFileSync('ditto', [source, staged])
    if (existsSync(installed)) renameSync(installed, backup)
    try {
      renameSync(staged, installed)
    } catch (err) {
      if (existsSync(backup)) renameSync(backup, installed)
      throw err
    }
  } catch (err) {
    remove(staged)
    throw err
  }
  remove(backup)
}
