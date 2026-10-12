import { beforeAll, describe, expect, it } from 'vitest'
import type { TFunction } from 'i18next'
import { makeT } from './testI18n'

// тексты, описывающие расчёт, должны с ним совпадать

let ru: TFunction
let en: TFunction

beforeAll(async () => {
  ru = await makeT('ru')
  en = await makeT('en')
})

describe('тексты экрана погоды совпадают с расчётом', () => {
  // WindArrow поворачивает стрелку на deg + 180: она показывает, куда дует ветер
  it('заголовок колонки ветра — «куда дует», как стрелка', () => {
    expect(ru('weatherScreen.table.wind')).toContain('куда дует')
    expect(ru('weatherScreen.table.wind')).not.toContain('откуда')
    expect(en('weatherScreen.table.wind')).toContain('blows to')
  })

  // current.precipitation у Open-Meteo это сумма за 15 минут (current.interval = 900)
  it('осадки в карточке «Сейчас» — за 15 минут, а не за час', () => {
    expect(ru('weatherScreen.current.precip')).toBe('Осадки за 15 мин')
    expect(en('weatherScreen.current.precip')).toBe('Precipitation, last 15 min')
  })

  // gustAtAltitude аддитивна: ветер на высоте плюс превышение порыва у земли
  it('заметка к графику описывает аддитивную модель порывов', () => {
    expect(ru('weatherScreen.chart.note')).not.toContain('отношению')
    expect(ru('weatherScreen.chart.note')).toContain('плюс превышение порыва')
    expect(en('weatherScreen.chart.note')).not.toContain('ratio')
  })

  // Перелёты к точке разбиения и обратно в число вылетов не входят: это оценка снизу
  it('число вылетов подано как нижняя граница', () => {
    expect(ru('flightForecast.estimate.sorties', { count: 2 })).toBe('Нужно не меньше 2 вылетов')
    expect(ru('flightForecast.estimate.sorties', { count: 5 })).toBe('Нужно не меньше 5 вылетов')
    expect(ru('flightForecast.estimate.sorties', { count: 21 })).toBe('Нужно не меньше 21 вылета')
    expect(en('flightForecast.estimate.sorties', { count: 3 })).toBe('At least 3 sorties needed')
  })
})
