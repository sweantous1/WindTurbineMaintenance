import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DRONE_PROFILE,
  DEFAULT_FLIGHT_ALTITUDE_M,
  DEFAULT_LIMITS,
  FLIGHT_ALTITUDE_MAX_M,
  FLIGHT_ALTITUDE_MIN_M,
  LEGACY_DEFAULT_DRONE_NAME,
} from '../defaults'

describe('значения по умолчанию', () => {
  it('имя встроенного профиля без «(по умолчанию)»: это показывает плашка, а старое имя узнаётся', () => {
    expect(DEFAULT_DRONE_PROFILE.name).toBe('Квадрокоптер')
    expect(DEFAULT_DRONE_PROFILE.name).not.toMatch(/умолчани/)
    // Так профиль назывался в уже созданных базах и снимках облетанных миссий
    expect(LEGACY_DEFAULT_DRONE_NAME).toBe('Квадрокоптер (по умолчанию)')
  })

  it('один диапазон высоты полёта на все экраны, и умолчания в него попадают', () => {
    expect([FLIGHT_ALTITUDE_MIN_M, FLIGHT_ALTITUDE_MAX_M]).toEqual([10, 500])
    for (const alt of [DEFAULT_FLIGHT_ALTITUDE_M, DEFAULT_LIMITS.maxAltitudeM, DEFAULT_DRONE_PROFILE.maxAltitudeM]) {
      expect(alt).toBeGreaterThanOrEqual(FLIGHT_ALTITUDE_MIN_M)
      expect(alt).toBeLessThanOrEqual(FLIGHT_ALTITUDE_MAX_M)
    }
  })
})
