import { describe, expect, it, vi } from 'vitest'
import { autoSpeed, createSimClock, SPEED_OPTIONS } from '../simClock'

describe('autoSpeed', () => {
  it('подбирает скорость, при которой облёт идёт около двух минут', () => {
    // 55 мин полёта: x20 даёт 2,75 мин, x50 1,1 мин, ближе по порядку x20
    expect(autoSpeed(55 * 60)).toBe(20)
    expect(autoSpeed(100)).toBe(1)
    expect(autoSpeed(10 * 3600)).toBe(100)
    expect(autoSpeed(0)).toBe(1)
    expect(SPEED_OPTIONS).toContain(autoSpeed(1234))
  })
})

describe('createSimClock', () => {
  it('идёт только после play, с выбранной скоростью', () => {
    const c = createSimClock(100, { speed: 10 })
    c.tick(1)
    expect(c.timeS()).toBe(0)
    c.play()
    c.tick(0.1)
    expect(c.timeS()).toBeCloseTo(1, 12)
    c.pause()
    c.tick(0.1)
    expect(c.timeS()).toBeCloseTo(1, 12)
  })

  it('долгий кадр не прыгает вперёд больше чем на четверть секунды реального времени', () => {
    const c = createSimClock(1000, { speed: 10 })
    c.play()
    c.tick(5)
    expect(c.timeS()).toBeCloseTo(2.5, 12)
  })

  it('в конце останавливается ровно на длительности и сообщает сразу', () => {
    const c = createSimClock(10, { speed: 100 })
    const listener = vi.fn()
    c.subscribe(listener)
    c.play()
    listener.mockClear()
    c.tick(0.2)
    expect(c.timeS()).toBe(10)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(c.getSnapshot()).toMatchObject({ playing: false, ended: true, timeS: 10 })
    // Повтор после конца идёт с начала
    c.play()
    expect(c.timeS()).toBe(0)
    expect(c.getSnapshot().playing).toBe(true)
  })

  it('интерфейс уведомляется не чаще интервала, а снимок между уведомлениями не меняется', () => {
    const c = createSimClock(1000, { speed: 1, notifyIntervalS: 0.1 })
    const listener = vi.fn()
    c.subscribe(listener)
    c.play()
    listener.mockClear()
    const before = c.getSnapshot()
    for (let i = 0; i < 5; i++) c.tick(1 / 60)
    expect(listener).not.toHaveBeenCalled()
    expect(c.getSnapshot()).toBe(before)
    for (let i = 0; i < 2; i++) c.tick(1 / 60)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(c.getSnapshot()).not.toBe(before)
    expect(c.getSnapshot().timeS).toBeCloseTo(7 / 60, 9)
  })

  it('перемотка прижимается к краям; перемотка в конец останавливает', () => {
    const c = createSimClock(50)
    c.seek(-5)
    expect(c.timeS()).toBe(0)
    c.seek(NaN)
    expect(c.timeS()).toBe(0)
    c.play()
    c.seek(80)
    expect(c.timeS()).toBe(50)
    expect(c.getSnapshot()).toMatchObject({ playing: false, ended: true })
  })

  it('toggle и методы работают без привязки к объекту', () => {
    const c = createSimClock(50)
    const { toggle, play, pause } = c
    toggle()
    expect(c.getSnapshot().playing).toBe(true)
    pause()
    expect(c.getSnapshot().playing).toBe(false)
    play()
    expect(c.getSnapshot().playing).toBe(true)
  })

  it('неверная скорость игнорируется; пустой полёт не запускается', () => {
    const c = createSimClock(50, { speed: 5 })
    c.setSpeed(0)
    c.setSpeed(NaN)
    c.setSpeed(-1)
    expect(c.getSnapshot().speed).toBe(5)
    const empty = createSimClock(0)
    empty.play()
    expect(empty.getSnapshot().playing).toBe(false)
  })

  it('новая длительность прижимает текущее время', () => {
    const c = createSimClock(100)
    c.seek(80)
    c.setDuration(60)
    expect(c.timeS()).toBe(60)
    expect(c.getSnapshot()).toMatchObject({ durationS: 60, ended: true })
  })

  it('отписка работает', () => {
    const c = createSimClock(100)
    const listener = vi.fn()
    const off = c.subscribe(listener)
    off()
    c.seek(10)
    expect(listener).not.toHaveBeenCalled()
  })
})
