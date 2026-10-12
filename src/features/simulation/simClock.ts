// Часы облёта. Сцена читает timeS() каждый кадр, а UI подписан через useSyncExternalStore
// и обновляется не чаще notifyIntervalS

export interface SimSnapshot {
  timeS: number
  durationS: number
  playing: boolean
  speed: number
  ended: boolean
}

export interface SimClock {
  getSnapshot(): SimSnapshot
  subscribe(listener: () => void): () => void
  timeS(): number
  play(): void
  pause(): void
  toggle(): void
  restart(): void
  seek(timeS: number): void
  setSpeed(speed: number): void
  setDuration(durationS: number): void
  // Реальное время с прошлого кадра, секунды
  tick(realDtS: number): void
}

// Во сколько раз быстрее реального времени
export const SPEED_OPTIONS: readonly number[] = [1, 5, 10, 20, 50, 100]

// После долгой паузы кадра (вкладка была скрыта, окно тащили) не прыгаем вперёд
const MAX_FRAME_DT_S = 0.25

// Скорость, при которой облёт проигрывается примерно за targetS секунд
export function autoSpeed(durationS: number, targetS = 120): number {
  if (!(durationS > 0) || !(targetS > 0)) return SPEED_OPTIONS[0]
  const want = durationS / targetS
  let best = SPEED_OPTIONS[0]
  for (const s of SPEED_OPTIONS) {
    if (Math.abs(Math.log(s / want)) < Math.abs(Math.log(best / want))) best = s
  }
  return best
}

export function createSimClock(durationS: number, opts: { speed?: number; notifyIntervalS?: number } = {}): SimClock {
  const notifyIntervalS = opts.notifyIntervalS ?? 0.1
  let duration = Math.max(0, Number.isFinite(durationS) ? durationS : 0)
  let time = 0
  let playing = false
  let speed = validSpeed(opts.speed) ?? autoSpeed(duration)
  let sinceNotify = 0
  let snapshot = makeSnapshot()
  const listeners = new Set<() => void>()

  function makeSnapshot(): SimSnapshot {
    return { timeS: time, durationS: duration, playing, speed, ended: time >= duration }
  }

  function notify() {
    sinceNotify = 0
    snapshot = makeSnapshot()
    for (const l of [...listeners]) l()
  }

  function play() {
    if (duration <= 0) return
    // Повтор после конца идёт с начала
    if (time >= duration) time = 0
    playing = true
    notify()
  }

  function pause() {
    if (!playing) return
    playing = false
    notify()
  }

  function clamp(t: number): number {
    return Number.isFinite(t) ? Math.min(Math.max(t, 0), duration) : 0
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    timeS: () => time,
    play,
    pause,
    // Без this: методы можно передавать как обработчики, не привязывая
    toggle: () => (playing ? pause() : play()),
    restart() {
      time = 0
      notify()
    },
    seek(t) {
      time = clamp(t)
      if (time >= duration) playing = false
      notify()
    },
    setSpeed(s) {
      const v = validSpeed(s)
      if (v === undefined || v === speed) return
      speed = v
      notify()
    },
    setDuration(d) {
      duration = Math.max(0, Number.isFinite(d) ? d : 0)
      time = clamp(time)
      if (time >= duration) playing = false
      notify()
    },
    tick(realDtS) {
      if (!playing || !(realDtS > 0)) return
      const dt = Math.min(realDtS, MAX_FRAME_DT_S)
      time = Math.min(duration, time + dt * speed)
      if (time >= duration) {
        playing = false
        notify()
        return
      }
      sinceNotify += dt
      if (sinceNotify >= notifyIntervalS) notify()
    },
  }
}

function validSpeed(s: number | undefined): number | undefined {
  return s !== undefined && Number.isFinite(s) && s > 0 ? s : undefined
}
