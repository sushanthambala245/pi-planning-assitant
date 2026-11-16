const known: Record<string, string> = {
  Platform: '#378ADD',
  Compliance: '#1D9E75',
  Product: '#EF9F27',
  Data: '#D4537E',
  Other: '#888780',
}

const fallback = ['#7F77DD', '#D85A30', '#5DCAA5', '#639922', '#BA7517', '#E24B4A']

/** Stable colour per domain name; unknown domains hash into a fallback palette. */
export function domainColor(domain: string): string {
  if (known[domain]) return known[domain]
  let h = 0
  for (const c of domain) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return fallback[h % fallback.length]
}
