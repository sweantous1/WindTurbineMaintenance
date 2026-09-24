import L from 'leaflet'
import { escapeHtml } from '@/utils/format'

// Служебные элементы карты: подписи, которые Leaflet ставит по-английски, доступные имена
// маркеров и состояние подложки. Без React — чтобы проверялось тестами

export interface MapLabels {
  zoomIn: string
  zoomOut: string
  closePopup: string
  leafletTitle: string
}

// Доступное имя слою (маркеру, всплывающему окну), когда у него уже есть элемент
export function labelElement(el: HTMLElement | undefined | null, label: string): void {
  el?.setAttribute('aria-label', label)
}

// Ссылка на Leaflet в атрибуции: своя подсказка вместо английской; открывается отдельно, как у OSM,
// чтобы в веб-версии не уводить со страницы приложения
export function localizedPrefix(prefix: string, title: string): string {
  return prefix.replace(/<a\b[^>]*>/, `<a href="https://leafletjs.com" title="${escapeHtml(title)}" target="_blank" rel="noreferrer">`)
}

// Подписи карты на языке интерфейса. Кнопки масштаба пересоздаются: у L.Control.Zoom подписи
// задаются только при создании. Возвращает отмену — для смены языка и ухода с экрана
export function localizeMap(map: L.Map, labels: MapLabels): () => void {
  const zoom = L.control.zoom({ zoomInTitle: labels.zoomIn, zoomOutTitle: labels.zoomOut }).addTo(map)
  const prefix = L.Control.Attribution.prototype.options.prefix
  if (typeof prefix === 'string') map.attributionControl?.setPrefix(localizedPrefix(prefix, labels.leafletTitle))
  // Кнопку закрытия Leaflet создаёт с aria-label «Close popup» при каждом открытии окна
  const onPopupOpen = (e: L.PopupEvent) => {
    labelElement(e.popup.getElement()?.querySelector<HTMLElement>('.leaflet-popup-close-button'), labels.closePopup)
  }
  map.on('popupopen', onPopupOpen)
  return () => {
    zoom.remove()
    map.off('popupopen', onPopupOpen)
  }
}

// Подложка не загрузилась: плашка — только когда не пришёл ни один тайл текущего вида (нет сети),
// а не при единичном сбое. 'load' у слоя тайлов приходит, когда обработаны все тайлы вида, и упавшие тоже
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
