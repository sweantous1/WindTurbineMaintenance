// Коды погоды WMO 4677 в том подмножестве, которое отдаёт Open-Meteo (поле weather_code)
export const WMO_CODES: readonly number[] = [
  0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99,
]

const KNOWN = new Set(WMO_CODES)

// Ключ перевода описания погоды, словари в src/i18n/features/wmo.*.json
export function wmoKey(code: number | null | undefined): string {
  return code != null && KNOWN.has(code) ? `wmo.${code}` : 'wmo.unknown'
}
