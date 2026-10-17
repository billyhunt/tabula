interface TitlebarProps {
  name: string
  dirty: boolean
}

export const Titlebar = ({ name, dirty }: TitlebarProps) => (
  <header className="titlebar">
    <span className="titlebar-name">
      {name}
      {dirty && <span className="dirty-dot" aria-label="Unsaved changes" />}
    </span>
    <span className="titlebar-brand">Tabula</span>
  </header>
)
