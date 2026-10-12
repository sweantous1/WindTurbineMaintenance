import L from 'leaflet'
import { escapeHtml } from '@/utils/format'

// Локализация контролов Leaflet, aria-имена маркеров и статус подложки.
// Без React, чтобы можно было покрыть тестами

export interface MapLabels {
  zoomIn: string
  zoomOut: string
  closePopup: string
  leafletTitle: string
}

// aria-label для слоя (маркер, попап), если элемент уже создан
export function labelElement(el: HTMLElement | undefined | null, label: string): void {
  el?.setAttribute('aria-label', label)
}

// Ссылка на Leaflet со своей подсказкой, в новой вкладке, чтобы не уводить из веб-версии.
// Без флага из дефолтного префикса: BSD-2 подписи не требует, атрибуцию OSM ставит слой тайлов
export function leafletPrefix(title: string): string {
  return `<a href="https://leafletjs.com" title="${escapeHtml(title)}" target="_blank" rel="noreferrer">Leaflet</a>`
}

// Зум-кнопки пересоздаём, у L.Control.Zoom подписи задаются только при создании.
// Возвращает функцию отмены
export function localizeMap(map: L.Map, labels: MapLabels): () => void {
  const zoom = L.control.zoom({ zoomInTitle: labels.zoomIn, zoomOutTitle: labels.zoomOut }).addTo(map)
  map.attributionControl?.setPrefix(leafletPrefix(labels.leafletTitle))
  // кнопку закрытия Leaflet создаёт с aria-label "Close popup" при каждом открытии попапа
  const onPopupOpen = (e: L.PopupEvent) => {
    labelElement(e.popup.getElement()?.querySelector<HTMLElement>('.leaflet-popup-close-button'), labels.closePopup)
  }
  map.on('popupopen', onPopupOpen)
  return () => {
    zoom.remove()
    map.off('popupopen', onPopupOpen)
  }
}

// Плашку показываем, только если не пришёл ни один тайл вида (нет сети), а не на единичный сбой.
// 'load' приходит, когда обработаны все тайлы, включая упавшие
export function tileStatusHandlers(onFailedChange: (failed: boolean) => void) {
  let loaded = 0
  let failed = 0
  return {
    loading: () => {
      loaded = 0
      failed = 0
    },
    tileload: () => {
      loaded++
      onFailedChange(false)
    },
    tileerror: () => {
      failed++
    },
    load: () => onFailedChange(loaded === 0 && failed > 0),
  }
}
