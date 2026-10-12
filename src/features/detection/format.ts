const formatters = new Map<string, Intl.NumberFormat>()

function numberFormat(lang: string, min: number, max: number): Intl.NumberFormat {
  const key = `${lang}|${min}|${max}`
  let f = formatters.get(key)
  if (!f) {
    f = new Intl.NumberFormat(lang, { minimumFractionDigits: min, maximumFractionDigits: max })
    formatters.set(key, f)
  }
  return f
}

// Всегда два знака: 0,87 / 0,10
export function formatConfidence(value: number, lang: string): string {
  return numberFormat(lang, 2, 2).format(value)
}

export function formatDecimal(value: number, lang: string, maxDigits = 3): string {
  return numberFormat(lang, 0, maxDigits).format(value)
}

export function formatMegabytes(bytes: number, lang: string): string {
  return numberFormat(lang, 1, 1).format(bytes / (1024 * 1024))
}

// До 10 с - секунды с десятыми, дальше минуты и целые секунды
export function durationParts(ms: number): { minutes: number; seconds: number } {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0
  if (safe < 10_000) return { minutes: 0, seconds: Math.round(safe / 100) / 10 }
  const total = Math.round(safe / 1000)
  return { minutes: Math.floor(total / 60), seconds: total % 60 }
}
