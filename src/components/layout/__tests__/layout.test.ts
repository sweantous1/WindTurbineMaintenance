// @vitest-environment happy-dom
import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { toast } from 'react-toastify'
import i18n from '@/i18n'
import { cleanup, render, waitFor } from '@/features/mission/__tests__/render'
import Layout from '../Layout'

afterEach(async () => {
  await act(async () => {
    toast.dismiss()
  })
  await cleanup()
  await i18n.changeLanguage('ru')
})

describe('область уведомлений', () => {
  it('область и кнопка закрытия подписаны на языке интерфейса, а не «Notifications Alt+T» и «close»', async () => {
    await i18n.changeLanguage('ru')
    await render(createElement(Layout))
    await act(async () => {
      toast.success('Сохранено')
    })
    await waitFor(() => expect(document.querySelector('.Toastify__close-button')).toBeTruthy())
    expect(document.querySelector('.Toastify')?.getAttribute('aria-label')).toBe('Уведомления (Alt+T)')
    expect(document.querySelector('.Toastify__close-button')?.getAttribute('aria-label')).toBe('Закрыть уведомление')

    await act(async () => {
      await i18n.changeLanguage('en')
    })
    await waitFor(() => expect(document.querySelector('.Toastify')?.getAttribute('aria-label')).toBe('Notifications (Alt+T)'))
    await act(async () => {
      toast.info('Saved')
    })
    await waitFor(() => {
      const labels = Array.from(document.querySelectorAll('.Toastify__close-button')).map((b) => b.getAttribute('aria-label'))
      expect(labels).toContain('Close notification')
    })
  })
})
