import { useEffect, useState } from 'react'
import type { AgentActivity } from '../../shared/ipc'

// Long enough to notice that something just happened to the board.
const LINGER_MS = 3000

const FALLBACK_LABEL: Record<AgentActivity['source'], string> = { ask: 'Ask', mcp: 'MCP' }

/**
 * The label of the agent working on the board, or null. It stays for a few
 * seconds after the agent stops so short tool calls are still seen.
 */
export const useAgentActivity = (): string | null => {
  const [label, setLabel] = useState<string | null>(null)
  useEffect(() => {
    const active: Partial<Record<AgentActivity['source'], string>> = {}
    let timer: number | undefined
    const stop = window.tabula.agent.onActivity((activity) => {
      if (activity.active) active[activity.source] = activity.label ?? FALLBACK_LABEL[activity.source]
      else delete active[activity.source]
      window.clearTimeout(timer)
      const current = active.ask ?? active.mcp
      if (current) setLabel(current)
      else timer = window.setTimeout(() => setLabel(null), LINGER_MS)
    })
    return () => {
      stop()
      window.clearTimeout(timer)
    }
  }, [])
  return label
}
