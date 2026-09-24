import { beforeAll, describe, expect, it } from 'vitest'
import type { TFunction } from 'i18next'
import type { HourAssessment, Reason } from '@/domain/flightCheck'
import { formatAge, formatReason, missingWindAltitudes, reasonKey } from '../reasons'
import { makeT } from './testI18n'

let ru: TFunction
let en: TFunction

beforeAll(async () => {
  ru = await makeT('ru')
  en = await makeT('en')
})

const r = (patch: Partial<Reason> & Pick<Reason, 'code'>): Reason => ({ severity: 'no', value: 0, limit: 0, ...patch })

describe('причины вердикта', () => {
  it('ветер — с высотой, лимитом и единицами, как в ТЗ', () => {
    const reason = r({ code: 'wind', value: 12.44, limit: 12, altM: 100 })
    expect(formatReason(reason, ru, 'ru')).toBe('ветер 12,4 м/с на 100 м при лимите 12 м/с')
    expect(formatReason(reason, en, 'en')).toBe('wind 12.4 m/s at 100 m with a limit of 12 m/s')
  })

  it('без высоты — без «на … м»', () => {
    expect(formatReason(r({ code: 'gust', value: 16.04, limit: 15 }), ru, 'ru')).toBe('порывы 16 м/с при лимите 15 м/с')
  })

  it('осадки в мм/ч с сотыми', () => {
    expect(formatReason(r({ code: 'precip', value: 0.45, limit: 0.5, severity: 'marginal' }), ru, 'ru')).toBe(
      'осадки 0,45 мм/ч при лимите 0,5 мм/ч',
    )
  })

  it('температура: ниже минимума и выше максимума — разные тексты', () => {
    expect(formatReason(r({ code: 'temp', value: -12.3, limit: -10 }), ru, 'ru')).toMatch(/^температура -12,3 °C ниже минимума -10 °C$/)
    expect(formatReason(r({ code: 'temp', value: 41, limit: 40 }), ru, 'ru')).toBe('температура 41 °C выше максимума 40 °C')
  })

  it('видимость и потолок', () => {
    expect(formatReason(r({ code: 'visibility', value: 1.25, limit: 3 }), ru, 'ru')).toBe('видимость 1,3 км при минимуме 3 км')
    expect(formatReason(r({ code: 'altitude', value: 150, limit: 120, altM: 150 }), ru, 'ru')).toBe(
      'высота полёта 150 м выше потолка 120 м',
    )
  })

  it('заряд: проценты или «не пройти», если против ветра не долететь', () => {
    const marginal = r({ code: 'battery', severity: 'marginal', value: 131.6, limit: 80, altM: 90 })
    expect(formatReason(marginal, ru, 'ru')).toBe(
      'в худшем случае нужно 132% заряда при доступных 80% — за один вылет не успеть',
    )
    const impossible = r({ code: 'battery', value: Infinity, limit: 80, altM: 90 })
    expect(reasonKey(impossible)).toBe('flightForecast.reasons.batteryImpossible')
    expect(formatReason(impossible, ru, 'ru')).not.toContain('Infinity')
    expect(formatReason(impossible, ru, 'ru')).not.toContain('∞')
  })

  it('для каждого кода причины есть перевод на обоих языках', () => {
    const all: Reason[] = [
      r({ code: 'wind' }),
      r({ code: 'wind', altM: 10 }),
      r({ code: 'gust' }),
      r({ code: 'gust', altM: 10 }),
      r({ code: 'precip' }),
      r({ code: 'temp', value: -20, limit: -10 }),
      r({ code: 'temp', value: 50, limit: 40 }),
      r({ code: 'visibility' }),
      r({ code: 'altitude' }),
      r({ code: 'battery', value: 90, limit: 80 }),
      r({ code: 'battery', value: Infinity, limit: 80 }),
    ]
    for (const reason of all) {
      for (const [t, lang] of [
        [ru, 'ru'],
        [en, 'en'],
      ] as const) {
        const text = formatReason(reason, t, lang)
        expect(text).not.toBe(reasonKey(reason))
        expect(text).not.toContain('{{')
      }
    }
  })
})

describe('нехватка данных о ветре', () => {
  it('перечисляет высоты без ветра или без порывов', () => {
    const a: HourAssessment = {
      status: 'insufficient',
      reasons: [],
      windByAlt: [
        { altM: 90, ms: 5, gustMs: 7, extrapolated: false },
        { altM: 100, ms: null, gustMs: null, extrapolated: false },
        { altM: 200, ms: 6, gustMs: null, extrapolated: true },
      ],
    }
    expect(missingWindAltitudes(a)).toEqual([100, 200])
  })
})

describe('возраст снимка', () => {
  it('русские плюралы', () => {
    expect(formatAge({ unit: 'minutes', count: 1 }, ru)).toBe('1 минуту назад')
    expect(formatAge({ unit: 'minutes', count: 3 }, ru)).toBe('3 минуты назад')
    expect(formatAge({ unit: 'minutes', count: 25 }, ru)).toBe('25 минут назад')
    expect(formatAge({ unit: 'hours', count: 21 }, ru)).toBe('21 час назад')
    expect(formatAge({ unit: 'hours', count: 4 }, ru)).toBe('4 часа назад')
    expect(formatAge({ unit: 'days', count: 11 }, ru)).toBe('11 дней назад')
  })

  it('английский и «только что»', () => {
    expect(formatAge({ unit: 'hours', count: 1 }, en)).toBe('1 hour ago')
    expect(formatAge({ unit: 'hours', count: 5 }, en)).toBe('5 hours ago')
    expect(formatAge({ unit: 'justNow', count: 0 }, ru)).toBe('только что')
    expect(formatAge(null, ru)).toBe('')
  })
})
