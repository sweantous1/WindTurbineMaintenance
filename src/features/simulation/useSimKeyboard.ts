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

// Фокус в поле или на кнопке: клавиша принадлежит им. Пробел на кнопке уже нажимает её саму,
// и без этой проверки пуск переключился бы дважды
const OWN_KEYS = 'input, textarea, select, button, [contenteditable]:not([contenteditable="false"])'

export function shouldIgnoreKey(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return true
  const target = e.target
  if (target instanceof Element && target.closest(OWN_KEYS)) return true
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
