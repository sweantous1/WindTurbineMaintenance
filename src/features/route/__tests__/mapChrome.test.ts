// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import L from 'leaflet'
import { labelElement, localizeMap, localizedPrefix, tileStatusHandlers, type MapLabels } from '../mapChrome'

const LABELS: MapLabels = { zoomIn: 'Приблизить', zoomOut: 'Отдалить', closePopup: 'Закрыть', leafletTitle: 'Библиотека «карт» & <тест>' }

let map: L.Map | undefined

// Карта без подложки: тайлы тестам не нужны, а запросов в сеть быть не должно
function makeMap(options: L.MapOptions = {}): L.Map {
  const el = document.createElement('div')
  document.body.appendChild(el)
  map = L.map(el, { zoomControl: false, ...options }).setView([52, 18.5], 12)
  return map
}

afterEach(() => {
  map?.remove()
  map = undefined
  document.body.innerHTML = ''
})

describe('доступное имя маркера точки взлёта', () => {
  it('ставится по событию add, когда элемент маркера уже создан', () => {
    const m = makeMap()
    const marker = L.marker([52, 18.5], { icon: L.divIcon({ html: 'H' }) })
    // До добавления на карту элемента нет — эффект при открытии экрана ставить имя было некуда
    expect(marker.getElement()).toBeUndefined()
    marker.on('add', (e) => labelElement((e.target as L.Marker).getElement(), 'Точка взлёта'))
    marker.addTo(m)
    const el = marker.getElement()
    expect(el?.getAttribute('role')).toBe('button')
    expect(el?.getAttribute('aria-label')).toBe('Точка взлёта')
  })

  it('без элемента — ничего не делает', () => {
    expect(() => labelElement(undefined, 'x')).not.toThrow()
    expect(() => labelElement(null, 'x')).not.toThrow()
  })
})

describe('подписи карты на языке интерфейса', () => {
  it('кнопки масштаба с переведёнными подсказками и именами', () => {
    const m = makeMap()
    localizeMap(m, LABELS)
    const zoomIn = m.getContainer().querySelector('.leaflet-control-zoom-in')
    const zoomOut = m.getContainer().querySelector('.leaflet-control-zoom-out')
    expect(zoomIn?.getAttribute('title')).toBe('Приблизить')
    expect(zoomIn?.getAttribute('aria-label')).toBe('Приблизить')
    expect(zoomOut?.getAttribute('title')).toBe('Отдалить')
    expect(zoomOut?.getAttribute('aria-label')).toBe('Отдалить')
    expect(m.getContainer().innerHTML).not.toContain('Zoom in')
  })

  it('смена языка пересоздаёт кнопки, а не добавляет вторые', () => {
    const m = makeMap()
    const undo = localizeMap(m, LABELS)
    undo()
    localizeMap(m, { ...LABELS, zoomIn: 'Zoom in', zoomOut: 'Zoom out' })
    const buttons = m.getContainer().querySelectorAll('.leaflet-control-zoom-in')
    expect(buttons).toHaveLength(1)
    expect(buttons[0].getAttribute('title')).toBe('Zoom in')
  })

  it('ссылка на Leaflet без английской подсказки и открывается отдельно', () => {
    const m = makeMap()
    localizeMap(m, LABELS)
    const link = m.getContainer().querySelector<HTMLAnchorElement>('.leaflet-control-attribution a')
    expect(link?.getAttribute('title')).toBe(LABELS.leafletTitle)
    expect(link?.getAttribute('target')).toBe('_blank')
    expect(link?.getAttribute('href')).toBe('https://leafletjs.com')
    expect(link?.textContent).toContain('Leaflet')
    expect(m.getContainer().innerHTML).not.toContain('A JavaScript library')
  })

  it('подсказка в префиксе экранируется', () => {
    const prefix = localizedPrefix('<a href="https://leafletjs.com" title="A JavaScript library">Leaflet</a>', '"><img src=x>')
    expect(prefix).not.toContain('<img')
    expect(prefix).toContain('&quot;&gt;&lt;img src=x&gt;')
    expect(prefix.endsWith('>Leaflet</a>')).toBe(true)
  })

  it('кнопка закрытия всплывающего окна получает переведённое имя', () => {
    const m = makeMap()
    localizeMap(m, LABELS)
    const popup = L.popup({ autoPan: false }).setLatLng([52, 18.5]).setContent('T1').openOn(m)
    const close = popup.getElement()?.querySelector('.leaflet-popup-close-button')
    expect(close?.getAttribute('aria-label')).toBe('Закрыть')
  })

  it('после отмены окно больше не трогается', () => {
    const m = makeMap()
    localizeMap(m, LABELS)()
    const popup = L.popup({ autoPan: false }).setLatLng([52, 18.5]).setContent('T1').openOn(m)
    expect(popup.getElement()?.querySelector('.leaflet-popup-close-button')?.getAttribute('aria-label')).toBe('Close popup')
    expect(m.getContainer().querySelector('.leaflet-control-zoom')).toBeNull()
  })
})

describe('состояние подложки', () => {
  it('плашка — когда не загрузился ни один тайл вида, и пропадает с первым загруженным', () => {
    const onChange = vi.fn()
    const h = tileStatusHandlers(onChange)
    h.loading()
    h.tileerror()
    h.tileerror()
    h.load()
    expect(onChange).toHaveBeenLastCalledWith(true)
    // Сеть вернулась: новый вид грузится
    h.loading()
    h.tileload()
    expect(onChange).toHaveBeenLastCalledWith(false)
    h.load()
    expect(onChange).toHaveBeenLastCalledWith(false)
  })

  it('единичный сбой среди загруженных тайлов плашку не показывает', () => {
    const onChange = vi.fn()
    const h = tileStatusHandlers(onChange)
    h.loading()
    h.tileload()
    h.tileerror()
    h.tileload()
    h.load()
    expect(onChange).not.toHaveBeenCalledWith(true)
  })

  it('счёт начинается заново с каждой загрузкой вида', () => {
    const onChange = vi.fn()
    const h = tileStatusHandlers(onChange)
    h.loading()
    h.tileload()
    h.load()
    // Следующий вид без сети: прошлые удачные тайлы не прячут сбой
    h.loading()
    h.tileerror()
    h.load()
    expect(onChange).toHaveBeenLastCalledWith(true)
  })

  it('события совпадают с настоящим слоем тайлов Leaflet', () => {
    const layer = L.tileLayer('https://example.invalid/{z}/{x}/{y}.png')
    const onChange = vi.fn()
    layer.on(tileStatusHandlers(onChange))
    layer.fire('loading')
    layer.fire('tileerror', { tile: document.createElement('img'), coords: L.point(0, 0), error: new Error('offline') })
    layer.fire('load')
    expect(onChange).toHaveBeenLastCalledWith(true)
  })
})
