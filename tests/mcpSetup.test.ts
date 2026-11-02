import { describe, expect, it } from 'vitest'
import { setupCommandFor } from '../src/main/agent/mcpSetup'

describe('setupCommandFor', () => {
  // Claude Code's default scope only covers the folder the command runs in,
  // a local entry there overrides a user one, and add refuses a name it has.
  it('clears this folder’s and the user entry, then registers Tabula for every project', () => {
    const command = setupCommandFor('http://127.0.0.1:7337/mcp', 'tok_en-1')
    expect(command.split('; ')).toEqual([
      'claude mcp remove --scope local tabula >/dev/null 2>&1',
      'claude mcp remove --scope user tabula >/dev/null 2>&1',
      'claude mcp add --scope user --transport http tabula http://127.0.0.1:7337/mcp --header "Authorization: Bearer tok_en-1"',
    ])
  })
})
