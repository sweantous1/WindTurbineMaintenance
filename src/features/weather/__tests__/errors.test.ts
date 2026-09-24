import { beforeAll, describe, expect, it } from 'vitest'
import type { TFunction } from 'i18next'
import { WeatherUnitsError } from '@/domain/weather'
import { OpenMeteoError } from '@/services/openMeteo'
import { isAbortError, weatherErrorMessage } from '../errors'
import { makeT } from './testI18n'

let ru: TFunction
let en: TFunction

beforeAll(async () => {
  ru = await makeT('ru')
  en = await makeT('en')
})

describe('тексты ошибок', () => {
  it('ошибки Open-Meteo переводятся по ключу на текущем языке', () => {
    const e = new OpenMeteoError('network')
    expect(weatherErrorMessage(e, ru)).toBe('Не удалось связаться с Open-Meteo. Проверьте подключение к интернету.')
    expect(weatherErrorMessage(e, en)).not.toBe(weatherErrorMessage(e, ru))
    expect(weatherErrorMessage(new OpenMeteoError('http', { status: 500, reason: 'boom' }), ru)).toContain('500')
  })

  it('неверные единицы — с полем и единицей', () => {
    const text = weatherErrorMessage(new WeatherUnitsError('wind_speed_10m', 'km/h', 'm/s'), ru)
    expect(text).toContain('wind_speed_10m')
    expect(text).toContain('km/h')
    expect(text).not.toContain('{{')
  })

  it('облетанная миссия — понятный текст вместо списка полей', () => {
    const locked = Object.assign(new Error('fields'), { name: 'MissionLockedError' })
    expect(weatherErrorMessage(locked, ru)).toBe('Миссия уже облетана — прогноз и час вылета менять нельзя.')
  })

  it('прочее — с исходным сообщением', () => {
    expect(weatherErrorMessage(new Error('диск полон'), ru)).toBe('Не удалось выполнить действие: диск полон')
    expect(weatherErrorMessage('строка', en)).toBe('The action failed: строка')
  })

  it('отмена запроса узнаётся и не считается ошибкой', () => {
    expect(isAbortError(new DOMException('aborted', 'AbortError'))).toBe(true)
    expect(isAbortError(new OpenMeteoError('timeout'))).toBe(false)
    expect(isAbortError('AbortError')).toBe(false)
  })
})
