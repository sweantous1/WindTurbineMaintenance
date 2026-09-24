// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import i18n from '@/i18n'
import ru from '@/i18n/ru.json'
import en from '@/i18n/en.json'
import Docs from '@/pages/Docs'
import { cleanup, render } from './render'

type Dict = { [key: string]: string | Dict }

const flatten = (obj: Dict, prefix = ''): string[] =>
  Object.entries(obj).flatMap(([k, v]) => (typeof v === 'string' ? [`${prefix}${k}`] : flatten(v, `${prefix}${k}.`)))

beforeAll(async () => {
  await i18n.changeLanguage('ru')
})

afterEach(async () => {
  await cleanup()
  await i18n.changeLanguage('ru')
})

describe('документация', () => {
  it('описывает весь порядок работы, включая 3D и дефекты, без обещаний «скоро»', async () => {
    await render(createElement(Docs))
    const steps = Array.from(document.querySelectorAll('ol > li h3')).map((h) => h.textContent)
    expect(steps).toEqual([
      'Миссия',
      'Ферма из KML/KMZ',
      'Маршрут',
      'Погода и час вылета',
      'Прогноз полёта',
      '3D-облёт',
      'Завершение полёта',
      'Поиск дефектов',
      'История',
    ])
    expect(document.querySelectorAll('ul > li h3')).toHaveLength(0)

    const text = document.body.textContent ?? ''
    // Старые тексты описывали точки маршрута по щелчку, «раздел в разработке» и демо-записи
    expect(text).not.toContain('добавить точку маршрута')
    expect(text).not.toContain('Раздел в разработке')
    expect(text).not.toContain('примеры записей')
    expect(text).toContain('Импорт KML/KMZ')
    expect(text).toContain('Получить прогноз')
    // «скоро» отдельным словом: «скорость» в описании 3D законна
    expect(text).not.toMatch(/(^|[^а-яё])скоро([^а-яё]|$)|следующ(ей|их) верси/i)
    expect(text).toContain('WebGPU')
    expect(text).toContain('Открыть в 3D')
  })

  it('на английском тоже без старых обещаний', async () => {
    await i18n.changeLanguage('en')
    await render(createElement(Docs))
    const text = document.body.textContent ?? ''
    expect(text).toContain('Workflow')
    expect(text).not.toContain('route point')
    expect(text).not.toContain('Sample records')
    expect(text).not.toContain('In progress: the forecast')
    expect(text).not.toMatch(/coming soon|next version|future version/i)
  })

  it('в русском и английском одинаковый набор ключей', () => {
    expect(flatten(en.docs as Dict).sort()).toEqual(flatten(ru.docs as Dict).sort())
  })

  it('пункт меню маршрутов на английском называется как ссылки на экран, а не «маршрутизатор»', () => {
    expect(en.nav.router).toBe('Routes')
  })
})
