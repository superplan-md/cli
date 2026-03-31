import type { ThemeMode } from '../../../shared/desktop-contract'

const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

function setDark(dark: boolean): void {
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
}

export function applyTheme(mode: ThemeMode): void {
  if (mode === 'system') {
    setDark(mediaQuery.matches)
  } else {
    setDark(mode === 'dark')
  }
}

// Keep system listener always registered; only acts when mode is 'system'
let currentMode: ThemeMode = 'system'

mediaQuery.addEventListener('change', () => {
  if (currentMode === 'system') {
    setDark(mediaQuery.matches)
  }
})

export function initTheme(mode: ThemeMode): void {
  currentMode = mode
  applyTheme(mode)
}

export function updateTheme(mode: ThemeMode): void {
  currentMode = mode
  applyTheme(mode)
}
