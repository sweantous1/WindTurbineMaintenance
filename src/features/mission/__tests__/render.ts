import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'

// Простая обвязка для рендера компонентов в happy-dom без сторонних библиотек

const reactEnv = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
reactEnv.IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLElement | null = null

export async function render(el: ReactElement): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const r = createRoot(host)
  container = host
  root = r
  await act(async () => {
    r.render(createElement(HashRouter, null, el))
  })
  return host
}

export async function cleanup(): Promise<void> {
  const r = root
  if (r) await act(async () => r.unmount())
  container?.remove()
  root = null
  container = null
  document.body.innerHTML = ''
}

// Живые запросы Dexie асинхронные, ждём пока проверка не пройдёт
export async function waitFor(check: () => void | Promise<void>, timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  for (;;) {
    try {
      await check()
      return
    } catch (error) {
      if (Date.now() - start > timeoutMs) throw error
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
      })
    }
  }
}

export function queryByText(selector: string, text: string): HTMLElement | undefined {
  return Array.from(document.querySelectorAll<HTMLElement>(selector)).find((e) => e.textContent?.includes(text))
}

export function getByText(selector: string, text: string): HTMLElement {
  const el = queryByText(selector, text)
  if (!el) throw new Error(`Не найден ${selector} с текстом «${text}»`)
  return el
}

export function getInput(id: string): HTMLInputElement {
  const el = document.getElementById(id)
  if (!(el instanceof HTMLInputElement)) throw new Error(`Нет поля #${id}`)
  return el
}

export async function click(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.click()
  })
}

// Через сеттер прототипа, иначе React не заметит изменения управляемого поля
export async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

export async function submit(form: HTMLFormElement): Promise<void> {
  await act(async () => {
    form.requestSubmit()
  })
}
