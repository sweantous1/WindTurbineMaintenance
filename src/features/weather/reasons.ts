import type { TFunction } from 'i18next'
import type { HourAssessment, Reason } from '@/domain/flightCheck'
import { formatNumber, type AgeUnit } from './format'

// Сколько знаков после запятой показывать: ветер Open-Meteo даёт десятые, осадки — сотые мм
const DIGITS: Record<Reason['code'], number> = {
  wind: 1,
  gust: 1,
  precip: 2,
  temp: 1,
  visibility: 1,
  battery: 0,
  altitude: 0,
}

export function reasonKey(r: Reason): string {
  switch (r.code) {
    case 'wind':
    case 'gust':
      return `flightForecast.reasons.${r.code}${r.altM != null ? 'At' : ''}`
    case 'temp':
      return r.value < r.limit ? 'flightForecast.reasons.tempLow' : 'flightForecast.reasons.tempHigh'
    case 'battery':
      // Infinity — против ветра дрон не продвигается: процент заряда здесь бессмыслен
      return Number.isFinite(r.value) ? 'flightForecast.reasons.battery' : 'flightForecast.reasons.batteryImpossible'
    default:
      return `flightForecast.reasons.${r.code}`
  }
}

// «ветер 12,4 м/с на 100 м при лимите 12 м/с»
export function formatReason(r: Reason, t: TFunction, lang: string): string {
  const digits = DIGITS[r.code]
  return t(reasonKey(r), {
    value: formatNumber(r.value, lang, digits),
    limit: formatNumber(r.limit, lang, digits),
    alt: formatNumber(r.altM, lang, 0),
  })
}

// «25 минут назад»; «только что» — без count, иначе i18next искал бы для нуля форму _many
export function formatAge(age: { unit: AgeUnit; count: number } | null, t: TFunction): string {
  if (!age) return ''
  if (age.unit === 'justNow') return t('weatherScreen.age.justNow')
  return t(`weatherScreen.age.${age.unit}`, { count: age.count })
}

// Высоты, на которых нет ветра или порывов: из-за них час получает «нет данных»
export function missingWindAltitudes(a: HourAssessment): number[] {
  return a.windByAlt.filter((w) => w.ms == null || w.gustMs == null).map((w) => w.altM)
}
