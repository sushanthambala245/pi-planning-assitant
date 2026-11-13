export interface Theme {
  id: string
  name: string
  tagline: string
  /** background, accent, text — shown as swatches in the picker */
  swatches: [string, string, string]
}

export const THEMES: Theme[] = [
  { id: 'accenture', name: 'Accenture', tagline: 'Core purple on black and white (default)', swatches: ['#ffffff', '#a100ff', '#000000'] },
  { id: 'accenture-dark', name: 'Accenture dark', tagline: 'Purple on black, for presenting', swatches: ['#0d0a12', '#be82ff', '#f3eefa'] },
  { id: 'slate', name: 'Slate Blue', tagline: 'Calm, neutral and professional', swatches: ['#f5f5f3', '#185fa5', '#1a1a18'] },
  { id: 'emerald', name: 'Emerald Fintech', tagline: 'Fresh, trustworthy, finance-friendly', swatches: ['#f2f6f4', '#0b7a5c', '#13211c'] },
  { id: 'sunset', name: 'Sunset Terracotta', tagline: 'Warm and approachable', swatches: ['#faf6f1', '#c2410c', '#2a1d14'] },
  { id: 'midnight', name: 'Midnight (dark)', tagline: 'Low-glare dark mode for long sessions', swatches: ['#0f1420', '#5aa9ff', '#e6ebf5'] },
]

// v2: the Accenture theme became the default, so an older saved choice of the old default does not hide it.
const KEY = 'pi-theme-v2'

export function getStoredTheme(): string {
  const saved = localStorage.getItem(KEY)
  if (saved === 'purple') return 'accenture' // the former "Corporate Purple" theme
  return THEMES.some((t) => t.id === saved) ? (saved as string) : THEMES[0].id
}

export function applyTheme(id: string) {
  document.documentElement.dataset.theme = id
  localStorage.setItem(KEY, id)
}
