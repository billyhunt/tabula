import './assetPath'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@excalidraw/excalidraw/index.css'
import './styles/index.css'
import './styles/shell.css'
import './styles/excalidraw.css'
import './styles/versions.css'
import './styles/agent.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
