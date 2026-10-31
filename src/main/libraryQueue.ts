/** At most this many downloaded libraries wait for a window. */
export const MAX_PENDING_INSTALLS = 5
/** Longest attacker-controlled text shown in a dialog. */
export const MAX_DIALOG_TEXT = 200

/** Adds an install unless its URL is already queued or the queue is full. */
export const enqueueInstall = <T extends { url: string }>(queue: T[], item: T): boolean => {
  if (queue.length >= MAX_PENDING_INSTALLS) return false
  if (queue.some((queued) => queued.url === item.url)) return false
  queue.push(item)
  return true
}

export const truncateForDialog = (text: string): string =>
  text.length > MAX_DIALOG_TEXT ? `${text.slice(0, MAX_DIALOG_TEXT)}…` : text
