/**
 * Node colour per ART (agile release train). Each known ART keeps one categorical slot, so a colour
 * always means the same ART whatever the filter shows (colour follows the entity, never its rank).
 * The slots are CSS variables (--art-1..8 in styles.css): validated as a set for light and dark
 * surfaces, and every node also carries a text label, so colour is never the only cue.
 */
const known: Record<string, number> = {
  'Core Banking & Ledger': 1,
  'Payments & Money Movement': 2,
  'Digital Channels': 3,
  'Cards & Lending': 4,
  'Risk, Compliance & Fraud Platform': 5,
  'Open Banking & Partner Integrations': 6,
}

export function domainColor(domain: string): string {
  if (!domain || domain === 'Other') return 'var(--art-other)'
  const slot = known[domain]
  if (slot) return `var(--art-${slot})`
  let h = 0
  for (const c of domain) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return `var(--art-${(h % 8) + 1})`
}
