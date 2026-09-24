// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { shouldIgnoreKey } from '../useSimKeyboard'

function press(code: string, target: Element, init: KeyboardEventInit = {}): KeyboardEvent {
  let seen: KeyboardEvent | null = null
  const listener = (e: Event) => {
    seen = e as KeyboardEvent
  }
  window.addEventListener('keydown', listener)
  target.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true, ...init }))
  window.removeEventListener('keydown', listener)
  if (!seen) throw new Error('событие не дошло до window')
  return seen
}

function add<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  document.body.appendChild(el)
  return el
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('shouldIgnoreKey', () => {
  it('после щелчка по кнопке C, R и скобки работают, а пробел остаётся кнопке', () => {
    const button = add('button')
    expect(shouldIgnoreKey(press('KeyC', button))).toBe(false)
    expect(shouldIgnoreKey(press('KeyR', button))).toBe(false)
    expect(shouldIgnoreKey(press('BracketRight', button))).toBe(false)
    expect(shouldIgnoreKey(press('Space', button))).toBe(true)
  })

  it('на шкале времени и флажке карты клавиши экрана работают; пробел на флажке — его', () => {
    const range = add('input', { type: 'range' })
    expect(shouldIgnoreKey(press('Space', range))).toBe(false)
    expect(shouldIgnoreKey(press('KeyC', range))).toBe(false)
    const checkbox = add('input', { type: 'checkbox' })
    expect(shouldIgnoreKey(press('KeyC', checkbox))).toBe(false)
    expect(shouldIgnoreKey(press('Space', checkbox))).toBe(true)
  })

  it('в полях для текста и списках любая клавиша принадлежит им', () => {
    for (const el of [add('input'), add('input', { type: 'number' }), add('textarea'), add('select'), add('div', { contenteditable: 'true' })]) {
      expect(shouldIgnoreKey(press('KeyC', el))).toBe(true)
      expect(shouldIgnoreKey(press('Space', el))).toBe(true)
    }
  })

  it('открытое окно и сочетания с Ctrl/Alt/Meta не трогаем', () => {
    const body = document.body
    expect(shouldIgnoreKey(press('KeyC', body))).toBe(false)
    expect(shouldIgnoreKey(press('KeyC', body, { ctrlKey: true }))).toBe(true)
    expect(shouldIgnoreKey(press('KeyR', body, { altKey: true }))).toBe(true)
    add('div', { role: 'dialog' })
    expect(shouldIgnoreKey(press('KeyC', body))).toBe(true)
  })
})
