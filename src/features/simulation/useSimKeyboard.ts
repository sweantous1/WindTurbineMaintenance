import { useEffect, useRef } from 'react'

export interface SimKeyActions {
  toggle: () => void
  restart: () => void
  slower: () => void
  faster: () => void
  nextCamera: () => void
}

// Клавиши по физическому положению: на русской раскладке R — это «К», а [ — «Х»
const KEY_ACTIONS: Readonly<Record<string, keyof SimKeyActions>> = {
  Space: 'toggle',
  KeyR: 'restart',
  BracketLeft: 'slower',
  BracketRight: 'faster',
  KeyC: 'nextCamera',
}

// Поля для текста и списки: любая клавиша принадлежит им
const TEXT_ENTRY =
  'textarea, select, [contenteditable]:not([contenteditable="false"]), ' +
  'input:not([type=button]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=submit]):not([type=reset])'
// Пробел сам нажимает кнопку, флажок и ссылку: без этой проверки пуск переключился бы дважды.
// Остальные клавиши экрана у кнопок своего смысла не имеют и работают после щелчка по ним
const SPACE_ACTIVATES =
  'button, a[href], summary, [role="button"], input[type=button], input[type=submit], input[type=reset], input[type=checkbox], input[type=radio]'

export function shouldIgnoreKey(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return true
  const target = e.target
  if (target instanceof Element) {
    if (target.closest(TEXT_ENTRY)) return true
    if (e.code === 'Space' && target.closest(SPACE_ACTIVATES)) return true
  }
  // Поверх экрана открыто окно — клавиши для него, а не для проигрывания
  return document.querySelector('[role="dialog"]') !== null
}

export function useSimKeyboard(actions: SimKeyActions): void {
  // Последние обработчики без переподписки на каждый рендер
  const ref = useRef(actions)
  useEffect(() => {
    ref.current = actions
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = KEY_ACTIONS[e.code]
      if (!action || shouldIgnoreKey(e)) return
      e.preventDefault()
      // Зажатая клавиша не должна дёргать пуск и паузу десятки раз
      if (e.repeat && action !== 'slower' && action !== 'faster') return
      ref.current[action]()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
