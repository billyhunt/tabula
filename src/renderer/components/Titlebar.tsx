interface TitlebarProps {
  name: string
  dirty: boolean
  /** What an agent is doing to the board right now, if anything. */
  agent?: string | null
}

export const Titlebar = ({ name, dirty, agent }: TitlebarProps) => (
  <header className="titlebar">
    <span className="titlebar-name">
      {name}
      {dirty && <span className="dirty-dot" aria-label="Unsaved changes" />}
    </span>
    <span className="titlebar-end">
      {/* A status, not a control: it must not break the drag region. */}
      <span className="agent-badge" role="status" hidden={!agent}>
        {agent && `Agent · ${agent}`}
      </span>
      <span className="titlebar-brand">Tabula</span>
    </span>
  </header>
)
