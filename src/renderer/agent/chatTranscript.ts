import type { Run } from './Chat'

/**
 * The conversation as Markdown, for Copy chat and Save chat. Tool steps stay
 * in, as a short list under each reply, so a saved chat still shows what was
 * done to the board.
 */
export const chatMarkdown = (runs: readonly Run[], drawingName: string | null, savedAt = new Date()) => {
  const lines = [`# Chat${drawingName ? ` about ${drawingName}` : ''}`, '', `Saved ${savedAt.toLocaleString()}`]
  for (const run of runs) {
    lines.push('', '## You', '', run.prompt.trim(), '', '## Claude')
    for (const step of run.steps) {
      lines.push('', step.kind === 'text' ? step.text.trim() : `- ${step.summary}`)
    }
    if (run.state === 'stopped') lines.push('', '_Stopped._')
    if (run.state === 'error' && run.error) lines.push('', `_Error: ${run.error}_`)
  }
  return `${lines.join('\n')}\n`
}
