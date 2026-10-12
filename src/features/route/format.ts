// Форматирование чисел для экрана маршрута. Бесконечность выводим как ∞
// (оценка заряда даёт её, если против ветра не долететь)

const formatters = new Map<string, Intl.NumberFormat>()

function formatter(lang: string, digits: number): Intl.NumberFormat {
  const key = `${lang}|${digits}`
  let f = formatters.get(key)
  if (!f) {
    f = new Intl.NumberFormat(lang, { maximumFractionDigits: digits, minimumFractionDigits: 0 })
    formatters.set(key, f)
  }
  return f
}

export function formatNumber(value: number, lang: string, digits = 0): string {
  if (Number.isNaN(value)) return '—'
  if (!Number.isFinite(value)) return value > 0 ? '∞' : '−∞'
  return formatter(lang, digits).format(value)
}

// короткие маршруты с сотыми, длинные с десятыми
export function formatKm(lengthM: number, lang: string): string {
  const km = lengthM / 1000
  return formatNumber(km, lang, Math.abs(km) < 10 ? 2 : 1)
}

const decimalSeparators = new Map<string, string>()

function decimalSeparator(lang: string): string {
  let sep = decimalSeparators.get(lang)
  if (sep === undefined) {
    sep = formatter(lang, 1).formatToParts(1.5).find((p) => p.type === 'decimal')?.value ?? '.'
    decimalSeparators.set(lang, sep)
  }
  return sep
}

// Число для поля ввода: без разделителей разрядов, с десятичным разделителем языка
// (parseNumberInput принимает и запятую, и точку)
export function formatInputNumber(value: number, lang: string): string {
  const s = String(value)
  const sep = decimalSeparator(lang)
  return sep === '.' ? s : s.replace('.', sep)
}

// координаты всегда с точкой и 6 знаками (~10 см), их копируют в другие программы
export function formatCoord(value: number): string {
  return value.toFixed(6)
}
