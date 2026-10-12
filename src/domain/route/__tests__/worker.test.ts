import { describe, expect, it } from 'vitest'
import { handleRouteMessage, type RouteWorkerResponse } from '@/workers/route.worker'

function run(data: unknown): RouteWorkerResponse[] {
  const out: RouteWorkerResponse[] = []
  handleRouteMessage(data, (msg) => out.push(msg))
  return out
}

describe('воркер маршрута', () => {
  it('на запрос отвечает результатом последним сообщением', () => {
    const out = run({
      type: 'solve',
      input: {
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 200, y: 0 },
          { x: 300, y: 0 },
        ],
        closed: false,
        algorithm: 'auto',
        thetaMaxDeg: 180,
      },
    })
    const last = out[out.length - 1]
    expect(last.type).toBe('result')
    if (last.type === 'result') {
      expect(last.result.visit).toEqual([1, 2, 3])
      expect(last.result.lengthM).toBeCloseTo(300, 9)
    }
    // Первый прогресс сразу, дальше не чаще раза в 100 мс
    expect(out.length).toBeGreaterThan(1)
    expect(out.slice(0, -1).every((m) => m.type === 'progress')).toBe(true)
  })

  it('запрос, искажённый при передаче, — ошибка с понятной причиной, а не TypeError', () => {
    const base = { closed: false, algorithm: 'auto', thetaMaxDeg: 180 }
    const cases: [unknown, RegExp][] = [
      [{ ...base, points: 'нет' }, /взлёта/],
      [{ ...base, points: [{ x: 0, y: 0 }, null] }, /числами/],
      [{ ...base, points: [{ x: 0, y: 0 }, { x: '1', y: 2 }] }, /числами/],
      [{ ...base, closed: 'да', points: [{ x: 0, y: 0 }] }, /взлёта/],
      [{ ...base, thetaMaxDeg: null, points: [{ x: 0, y: 0 }] }, /угол/],
    ]
    for (const [input, message] of cases) {
      const out = run({ type: 'solve', input })
      expect(out).toHaveLength(1)
      expect(out[0].type).toBe('error')
      if (out[0].type === 'error') {
        expect(out[0].message).toMatch(message)
        expect(out[0].message).not.toMatch(/Cannot read|undefined|null/)
      }
    }
  })

  it('ошибки входа и неизвестные сообщения превращаются в сообщение об ошибке', () => {
    expect(run({ type: 'solve', input: { points: [], closed: false, algorithm: 'auto', thetaMaxDeg: 180 } })).toEqual([
      { type: 'error', message: expect.stringMatching(/взлёта/) },
    ])
    expect(run({ type: 'ping' })[0].type).toBe('error')
    expect(run(null)[0].type).toBe('error')
  })
})
