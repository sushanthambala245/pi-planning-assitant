import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@tabler/icons-webfont/dist/tabler-icons.min.css'
import './styles.css'
import App from './App'
import { applyTheme, getStoredTheme } from './lib/theme'

applyTheme(getStoredTheme()) // before first paint, so there's no flash of the default theme

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
