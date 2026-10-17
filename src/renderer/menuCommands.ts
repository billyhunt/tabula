import { useEffect, useRef } from 'react'
import type { MenuCommand } from '../shared/ipc'

// One handler per command. Features register their own commands, so no single
// component has to know every menu item.
const handlers = new Map<MenuCommand, () => void>()
let subscribed = false

const subscribe = () => {
  if (subscribed) return
  subscribed = true
  window.tabula.onMenuCommand((cmd) => handlers.get(cmd)?.())
}

/**
 * Runs `handler` when the application menu sends `cmd` to this window.
 * The latest handler always runs, without re-registering on every render.
 */
export const useMenuCommand = (cmd: MenuCommand, handler: () => void) => {
  const latest = useRef(handler)
  latest.current = handler
  useEffect(() => {
    subscribe()
    const run = () => latest.current()
    handlers.set(cmd, run)
    return () => {
      if (handlers.get(cmd) === run) handlers.delete(cmd)
    }
  }, [cmd])
}
