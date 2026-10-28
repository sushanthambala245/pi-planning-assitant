export interface Theme {
  id: string
  name: string
  tagline: string
  /** background, accent, text — shown as swatches in the picker */
  swatches: [string, string, string]
}

export const THEMES: Theme[] = [
  { id: 'slate', name: 'Slate Blue', tagline: 'Calm, neutral and professional (original)', swatches: ['#f5f5f3', '#185fa5', '#1a1a18'] },
  { id: 'purple', name: 'Corporate Purple', tagline: 'Bold and brand-forward', swatches: ['#f7f3fb', '#7500c0', '#1d1226'] },
  { id: 'emerald', name: 'Emerald Fintech', tagline: 'Fresh, trustworthy, finance-friendly', swatches: ['#f2f6f4', '#0b7a5c', '#13211c'] },
  { id: 'sunset', name: 'Sunset Terracotta', tagline: 'Warm and approachable', swatches: ['#faf6f1', '#c2410c', '#2a1d14'] },
  { id: 'midnight', name: 'Midnight (dark)', tagline: 'Low-glare dark mode for long sessions', swatches: ['#0f1420', '#5aa9ff', '#e6ebf5'] },
]

const KEY = 'pi-theme'

export function getStoredTheme(): string {
  const saved = localStorage.getItem(KEY)
  return THEMES.some((t) => t.id === saved) ? (saved as string) : THEMES[0].id
}

export function applyTheme(id: string) {
  document.documentElement.dataset.theme = id
  localStorage.setItem(KEY, id)
}
