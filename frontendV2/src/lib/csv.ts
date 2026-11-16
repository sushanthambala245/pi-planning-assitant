/** Minimal RFC 4180 CSV parser: quoted fields, escaped quotes, embedded newlines, BOM. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else field += c
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

export interface CsvTable {
  headers: string[]
  records: Record<string, string>[]
}

/** Header names are normalised to snake_case ("story points" -> "story_points"). */
export function parseCsvTable(text: string): CsvTable {
  const [head = [], ...body] = parseCsv(text)
  const headers = head.map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'))
  const records = body.map((cells) =>
    Object.fromEntries(headers.map((h, i) => [h, (cells[i] ?? '').trim()])),
  )
  return { headers, records }
}
