import './index.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { OverlayWindow } from './components/overlay-window'
import { initTheme } from './lib/apply-theme'

// Bootstrap theme: read saved config before first render so there's no flash.
window.desktop
  .getConfig()
  .then((cfg) => initTheme(cfg.themeMode))
  .catch(() => initTheme('system'))

const route = window.location.hash.replace(/^#/, '') || 'board'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {route === 'overlay' ? <OverlayWindow /> : <App />}
  </StrictMode>
)
