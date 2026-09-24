// Свой генератор вместо Math.random: при том же seed расчёт повторяется точь-в-точь,
// и маршрут из сохранённой миссии можно пересчитать и получить тот же результат
export type Rng = () => number

// mulberry32: 32-битное состояние, период 2^32 — для перестановок из сотен точек достаточно
export function mulberry32(seed: number): Rng {
  let state = Math.trunc(seed) >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Целое из [0, maxExclusive)
export function randInt(rng: Rng, maxExclusive: number): number {
  return Math.floor(rng() * maxExclusive)
}

// Тасование Фишера — Йетса на месте
export function shuffleInPlace<T extends { length: number; [i: number]: number }>(arr: T, rng: Rng): T {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1)
    const tmp = arr[i]
    arr[i] = arr[j]
    arr[j] = tmp
  }
  return arr
}
