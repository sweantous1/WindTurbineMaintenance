import { beforeAll, describe, expect, it } from 'vitest'
import type { TFunction } from 'i18next'
import { DEFAULT_DRONE_PROFILE, DEFAULT_DRONE_PROFILE_ID, LEGACY_DEFAULT_DRONE_NAME } from '@/domain/defaults'
import { makeT } from '@/features/weather/__tests__/testI18n'
import { droneDisplayName, hasBuiltinName } from '../droneName'

let ru: TFunction
let en: TFunction

beforeAll(async () => {
  ru = await makeT('ru')
  en = await makeT('en')
})

describe('имя профиля дрона', () => {
  it('встроенное имя встроенного профиля — на языке интерфейса, и новое, и старое', () => {
    for (const name of [DEFAULT_DRONE_PROFILE.name, LEGACY_DEFAULT_DRONE_NAME]) {
      const p = { id: DEFAULT_DRONE_PROFILE_ID, name }
      expect(hasBuiltinName(p)).toBe(true)
      expect(droneDisplayName(p, en)).toBe('Quadcopter')
      expect(droneDisplayName(p, ru)).toBe('Квадрокоптер')
    }
  })

  it('переименованный встроенный и любой другой профиль — как назван', () => {
    expect(droneDisplayName({ id: DEFAULT_DRONE_PROFILE_ID, name: 'Мой дрон' }, en)).toBe('Мой дрон')
    expect(droneDisplayName({ id: 'x', name: LEGACY_DEFAULT_DRONE_NAME }, en)).toBe(LEGACY_DEFAULT_DRONE_NAME)
  })
})
