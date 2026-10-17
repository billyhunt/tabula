import { useEffect, useState } from 'react'

type Theme = 'light' | 'dark'

const query = window.matchMedia('(prefers-color-scheme: dark)')

/** Follows the macOS appearance, the way Alethia does. */
export const useSystemTheme = (): Theme => {
  const [theme, setTheme] = useState<Theme>(query.matches ? 'dark' : 'light')
  useEffect(() => {
    const onChange = (e: MediaQueryListEvent) => setTheme(e.matches ? 'dark' : 'light')
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return theme
}
