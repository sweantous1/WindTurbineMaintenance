import { kml as kmlToGeoJson } from '@tmcw/togeojson'
import type { Farm, GeoPoint, Turbine } from '@/domain/types'
import { DEFAULT_FARM_DEFAULTS } from '@/domain/defaults'
import { centroid, haversineM } from '@/lib/geo'

// Импорт фермы из KML/KMZ и выгрузка фермы с маршрутом обратно в KML 2.2

export interface FarmImport {
  name?: string
  turbines: Turbine[]
  skipped: number
  merged: number
  fileName: string
  sha256: string
}

export type KmlImportErrorCode = 'noTurbines' | 'notKml' | 'invalidXml' | 'kmzBroken' | 'kmzNoKml' | 'tooLarge' | 'readFailed'

// code — для перевода в интерфейсе, message — русский текст на случай, если перевода нет
export class KmlImportError extends Error {
  readonly code: KmlImportErrorCode
  constructor(code: KmlImportErrorCode, message: string) {
    super(message)
    this.name = 'KmlImportError'
    this.code = code
  }
}

const MERGE_DISTANCE_M = 5
const MOVED_THRESHOLD_M = 1
// Та же турбина при повторном импорте: поправка координат бывает, перенос на километр — уже другая ферма
const SAME_TURBINE_M = 1000
const MAX_FILE_BYTES = 50 * 1024 * 1024
const MAX_KML_BYTES = 100 * 1024 * 1024

type KmlFeature = ReturnType<typeof kmlToGeoJson>['features'][number]
type KmlGeometry = NonNullable<KmlFeature['geometry']>

interface DomPoint {
  coords: number[]
  absolute: boolean
  used: boolean
}

interface Candidate {
  name: string
  lat: number
  lon: number
  groundAltM?: number
}

function noTurbinesError(): KmlImportError {
  return new KmlImportError('noTurbines', 'В файле нет точек-турбин')
}

// Тот же разбор, что у togeojson (coord1), — чтобы сопоставить точку GeoJSON с её элементом <Point>
function parseCoordTuple(text: string): number[] {
  return text
    .replace(/\s*/g, '')
    .split(',')
    .map(Number.parseFloat)
    .filter((n) => !Number.isNaN(n))
    .slice(0, 3)
}

function childElement(parent: Element, tagName: string): Element | undefined {
  return Array.from(parent.children).find((el) => el.tagName === tagName)
}

// Только собственный дочерний элемент: togeojson берёт первый <name> где угодно внутри метки
// и перекрывает его полем name из ExtendedData, а это уже не имя метки
function childText(parent: Element, tagName: string): string {
  return childElement(parent, tagName)?.textContent?.trim() ?? ''
}

// togeojson не отдаёт altitudeMode, поэтому режим высоты читается из DOM самой точки
// (altitudeMode у LookAt рядом с точкой к ней не относится)
function domPoints(placemark: Element): DomPoint[] {
  return Array.from(placemark.getElementsByTagName('Point')).map((el) => ({
    coords: parseCoordTuple(el.getElementsByTagName('coordinates')[0]?.textContent ?? ''),
    absolute: childText(el, 'altitudeMode') === 'absolute',
    used: false,
  }))
}

function takeDomPoint(points: DomPoint[], coords: number[]): DomPoint | undefined {
  const match = points.find((p) => !p.used && p.coords.length === coords.length && p.coords.every((v, i) => v === coords[i]))
  if (match) match.used = true
  return match
}

function flattenGeometry(geometry: KmlGeometry): KmlGeometry[] {
  return geometry.type === 'GeometryCollection' ? geometry.geometries.flatMap(flattenGeometry) : [geometry]
}

function isValidLatLon(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
}

function documentName(doc: Document): string | undefined {
  const root = doc.documentElement
  const container = root.tagName === 'kml' ? Array.from(root.children).find((el) => el.tagName === 'Document' || el.tagName === 'Folder') : root
  const name = container ? childText(container, 'name') : ''
  return name || undefined
}

// Широтная полоса ~11 м шире радиуса слияния, поэтому близкая точка всегда в своей или соседней полосе.
// Без индекса каждая точка сравнивалась бы со всеми принятыми: на файле в десятки тысяч точек — секунды
const MERGE_BAND_DEG = 1e-4

// Дубли одной турбины (например, метка скопирована в две папки) сливаются в первую принятую
function mergeClosePoints(candidates: Candidate[]): { accepted: Candidate[]; merged: number } {
  const accepted: Candidate[] = []
  const bands = new Map<number, number[]>()
  let merged = 0
  for (const c of candidates) {
    const band = Math.floor(c.lat / MERGE_BAND_DEG)
    let first = -1
    for (let b = band - 1; b <= band + 1; b++) {
      const near = bands.get(b)?.find((i) => haversineM(accepted[i], c) < MERGE_DISTANCE_M)
      if (near !== undefined && (first === -1 || near < first)) first = near
    }
    if (first === -1) {
      const list = bands.get(band)
      if (list) list.push(accepted.length)
      else bands.set(band, [accepted.length])
      accepted.push(c)
      continue
    }
    merged++
    const target = accepted[first]
    if (target.groundAltM === undefined && c.groundAltM !== undefined) target.groundAltM = c.groundAltM
  }
  return { accepted, merged }
}

export function parseKmlText(text: string): { name?: string; turbines: Turbine[]; skipped: number; merged: number } {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new KmlImportError('invalidXml', 'Файл не читается как KML: XML в нём повреждён или это другой формат. Нужен KML или KMZ из Google Earth')
  }

  // togeojson сначала выдаёт по одному объекту на каждый Placemark в порядке документа,
  // затем GroundOverlay и NetworkLink — у них пары в placemarks нет, они идут в skipped
  const placemarks = Array.from(doc.getElementsByTagName('Placemark'))
  const features = kmlToGeoJson(doc).features
  const candidates: Candidate[] = []
  let skipped = 0

  features.forEach((feature, index) => {
    const placemark = placemarks[index]
    if (!placemark || !feature.geometry) {
      skipped++
      return
    }
    const name = childText(placemark, 'name')
    const points = domPoints(placemark)
    for (const geometry of flattenGeometry(feature.geometry)) {
      if (geometry.type !== 'Point') {
        skipped++
        continue
      }
      const [lon, lat, alt] = geometry.coordinates
      // Точка без своего <Point> — это короткий gx:Track, турбиной он не считается
      const source = takeDomPoint(points, geometry.coordinates)
      if (!source || !isValidLatLon(lat, lon)) {
        skipped++
        continue
      }
      const candidate: Candidate = { name, lat, lon }
      if (source.absolute && Number.isFinite(alt)) candidate.groundAltM = alt
      candidates.push(candidate)
    }
  })

  const { accepted, merged } = mergeClosePoints(candidates)
  if (accepted.length === 0) throw noTurbinesError()

  // id из имени — только если имена однозначны, иначе повторный импорт перепутал бы турбины
  const names = accepted.map((c) => c.name)
  const namesAreIds = names.every((n) => n !== '') && new Set(names).size === names.length
  const turbines = accepted.map((c, i): Turbine => {
    const turbine: Turbine = {
      id: namesAreIds ? c.name : `t${i + 1}`,
      name: c.name || `T${i + 1}`,
      lat: c.lat,
      lon: c.lon,
    }
    if (c.groundAltM !== undefined) turbine.groundAltM = c.groundAltM
    return turbine
  })

  const name = documentName(doc)
  return { ...(name ? { name } : {}), turbines, skipped, merged }
}

// ---------- Файл: KML или KMZ ----------

// PK\x03\x04 — первая запись архива, PK\x05\x06 — пустой архив (одно оглавление)
function isZip(bytes: Uint8Array): boolean {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return false
  return (bytes[2] === 0x03 && bytes[3] === 0x04) || (bytes[2] === 0x05 && bytes[3] === 0x06)
}

// DOMParser получает строку, поэтому кодировку из XML-декларации (часто windows-1251) применяем сами
function decodeXml(bytes: Uint8Array): string {
  // Метка порядка байтов главнее объявленной кодировки
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes)
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes)
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes)
  const head = new TextDecoder('windows-1252').decode(bytes.subarray(0, 256))
  const label = /^\s*<\?xml[^>]*?encoding\s*=\s*["']([A-Za-z0-9._:-]+)["']/.exec(head)?.[1]
  // Декларация прочиталась однобайтово, значит, файл не UTF-16, что бы в ней ни было написано
  if (label && !/^utf-?16/i.test(label)) {
    try {
      return new TextDecoder(label).decode(bytes)
    } catch {
      // Неизвестная кодировка — читаем как UTF-8
    }
  }
  return new TextDecoder('utf-8').decode(bytes)
}

function isKmlEntry(name: string): boolean {
  const baseName = name.split('/').pop() ?? ''
  return /\.kml$/i.test(baseName) && !baseName.startsWith('._') && !name.startsWith('__MACOSX/')
}

function kmzBrokenError(): KmlImportError {
  return new KmlImportError('kmzBroken', 'Архив KMZ повреждён или не является ZIP')
}

// По соглашению KMZ основной документ — doc.kml в корне, иначе первый .kml в корне архива.
// Первый проход читает только оглавление, второй распаковывает один выбранный .kml:
// лишние и битые .kml в архиве не мешают, а слишком большой doc.kml не подменяется другим файлом
async function extractKml(zip: Uint8Array): Promise<Uint8Array> {
  const { unzipSync } = await import('fflate')
  const entries: { name: string; bytes: number }[] = []
  try {
    unzipSync(zip, {
      filter: (f) => {
        if (isKmlEntry(f.name)) entries.push({ name: f.name, bytes: Math.max(f.size, f.originalSize) })
        return false
      },
    })
  } catch {
    throw kmzBrokenError()
  }
  const main = entries.find((e) => e.name.toLowerCase() === 'doc.kml') ?? entries.find((e) => !e.name.includes('/')) ?? entries[0]
  if (!main) throw new KmlImportError('kmzNoKml', 'Это ZIP-архив без файла .kml внутри, а не KMZ. Нужен KML или KMZ из Google Earth с метками турбин')
  if (main.bytes > MAX_KML_BYTES) throw new KmlImportError('tooLarge', 'KML внутри архива слишком большой (больше 100 МБ)')
  let data: Uint8Array | undefined
  try {
    data = unzipSync(zip, { filter: (f) => f.name === main.name })[main.name]
  } catch {
    throw kmzBrokenError()
  }
  if (!data) throw kmzBrokenError()
  return data
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))

// crypto.subtle есть только в защищённом контексте; веб-версия по http из локальной сети
// его не получит, а отпечаток файла нужен и там
function sha256Js(data: Uint8Array): Uint8Array {
  const padded = new Uint8Array(((data.length + 9 + 63) >> 6) << 6)
  padded.set(data)
  padded[data.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, Math.floor(data.length / 0x20000000))
  view.setUint32(padded.length - 4, (data.length * 8) >>> 0)
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])
  const w = new Uint32Array(64)
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4)
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
      w[i] = w[i - 16] + s0 + w[i - 7] + s1
    }
    let [a, b, c, d, e, f, g, k] = h
    for (let i = 0; i < 64; i++) {
      const t1 = (k + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + SHA256_K[i] + w[i]) >>> 0
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0
      k = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }
    h[0] += a
    h[1] += b
    h[2] += c
    h[3] += d
    h[4] += e
    h[5] += f
    h[6] += g
    h[7] += k
  }
  const out = new Uint8Array(32)
  const outView = new DataView(out.buffer)
  h.forEach((v, i) => outView.setUint32(i * 4, v))
  return out
}

export async function sha256Hex(data: Uint8Array<ArrayBuffer>): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  const digest = subtle ? new Uint8Array(await subtle.digest('SHA-256', data)) : sha256Js(data)
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
}

export async function readFarmFile(file: File): Promise<FarmImport> {
  if (file.size > MAX_FILE_BYTES) throw new KmlImportError('tooLarge', 'Файл слишком большой для KML/KMZ (больше 50 МБ)')
  let bytes: Uint8Array<ArrayBuffer>
  try {
    bytes = new Uint8Array(await file.arrayBuffer())
  } catch {
    throw new KmlImportError('readFailed', 'Не удалось прочитать файл')
  }
  // Тип определяется по содержимому: KMZ с расширением .kml (и наоборот) встречается
  const zip = isZip(bytes)
  const text = decodeXml(zip ? await extractKml(bytes) : bytes)
  // Перетащить можно что угодно; фото или PDF — не «ошибка в XML», а просто не тот файл
  if (!zip && !text.trimStart().startsWith('<')) {
    throw new KmlImportError('notKml', 'Это не KML и не KMZ. Нужен файл из Google Earth с метками турбин')
  }
  const parsed = parseKmlText(text)
  return { ...parsed, fileName: file.name, sha256: await sha256Hex(bytes) }
}

// ---------- Ферма ----------

// Имя фермы после импорта. Без имени в файле прежнее переносится, только если это та же ферма
// (есть общая турбина на прежнем месте): иначе другая ферма получила бы чужое название.
// Одних id мало: у меток без уникальных имён они t1…tN у любой фермы
export function importedFarmName(imp: Pick<FarmImport, 'name' | 'turbines'>, previous?: Farm): string | undefined {
  if (imp.name) return imp.name
  if (!previous?.name) return undefined
  const prevById = new Map(previous.turbines.map((t) => [t.id, t]))
  const same = imp.turbines.some((t) => {
    const old = prevById.get(t.id)
    return old !== undefined && haversineM(old, t) <= SAME_TURBINE_M
  })
  return same ? previous.name : undefined
}

export function farmFromImport(imp: FarmImport, previous?: Farm): Farm {
  if (imp.turbines.length === 0) throw noTurbinesError()
  const name = importedFarmName(imp, previous)
  return {
    ...(name ? { name } : {}),
    center: centroid(imp.turbines),
    source: { fileName: imp.fileName, sha256: imp.sha256, importedAt: new Date().toISOString() },
    defaults: { ...(previous?.defaults ?? DEFAULT_FARM_DEFAULTS) },
    turbines: imp.turbines.map((t) => ({ ...t })),
  }
}

export function diffTurbines(prev: Turbine[], next: Turbine[]): { added: number; removed: number; moved: number } {
  const prevById = new Map(prev.map((t) => [t.id, t]))
  const nextIds = new Set(next.map((t) => t.id))
  let added = 0
  let moved = 0
  for (const t of next) {
    const old = prevById.get(t.id)
    if (!old) added++
    else if (haversineM(old, t) > MOVED_THRESHOLD_M) moved++
  }
  const removed = [...prevById.keys()].filter((id) => !nextIds.has(id)).length
  return { added, removed, moved }
}

// ---------- Выгрузка в KML ----------

// \r — ссылкой на символ: как есть парсер XML превратил бы его в \n, и имя не вернулось бы при импорте
const XML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;', '\r': '&#13;' }

function isXmlChar(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0
  if (c < 0x20) return c === 0x09 || c === 0x0a || c === 0x0d
  // Одиночные суррогаты и U+FFFE/U+FFFF в XML 1.0 недопустимы
  return (c < 0xd800 || c > 0xdfff) && c !== 0xfffe && c !== 0xffff
}

// Недопустимые в XML символы выбрасываются: иначе файл не откроется ни в одном просмотрщике
function escapeXml(value: string): string {
  return Array.from(value)
    .filter(isXmlChar)
    .join('')
    .replace(/[&<>"'\r]/g, (ch) => XML_ESCAPES[ch])
}

// Фиксированная точка без экспоненты: 1e-7 не все просмотрщики KML понимают
function formatNumber(value: number, digits: number): string {
  const s = value.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '')
  return s === '-0' ? '0' : s
}

// 8 знаков после запятой — около 1 мм
function formatCoord(p: GeoPoint, altM?: number): string {
  const lonLat = `${formatNumber(p.lon, 8)},${formatNumber(p.lat, 8)}`
  return altM === undefined ? lonLat : `${lonLat},${formatNumber(altM, 2)}`
}

export function farmToKml(farm: Farm, opts: { name?: string; order?: string[]; path?: GeoPoint[] } = {}): string {
  const orderIndex = new Map<string, number>()
  opts.order?.forEach((id, i) => {
    if (!orderIndex.has(id)) orderIndex.set(id, i)
  })
  // Сначала турбины в порядке облёта, затем остальные — так список в Google Earth читается по маршруту
  const turbines = farm.turbines
    .map((t, i) => ({ t, i, n: orderIndex.get(t.id) }))
    .sort((a, b) => (a.n ?? Infinity) - (b.n ?? Infinity) || a.i - b.i)

  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<kml xmlns="http://www.opengis.net/kml/2.2">', '<Document>']
  const docName = opts.name ?? farm.name
  if (docName) lines.push(`  <name>${escapeXml(docName)}</name>`)
  const path = opts.path && opts.path.length >= 2 ? opts.path : undefined
  if (path) {
    lines.push(
      '  <Style id="wtm-path">',
      '    <LineStyle><color>ff00a5ff</color><width>3</width></LineStyle>',
      '  </Style>',
    )
  }
  // Номер — место среди турбин фермы, попавших в маршрут: id, которых в ферме уже нет, дыр в нумерации не дают
  turbines.forEach(({ t, n }, position) => {
    const label = n === undefined ? t.name : `${position + 1}. ${t.name}`
    // NaN в координатах сделал бы файл нечитаемым; без высоты точка остаётся на рельефе
    const altM = Number.isFinite(t.groundAltM) ? t.groundAltM : undefined
    lines.push('  <Placemark>', `    <name>${escapeXml(label)}</name>`, '    <Point>')
    if (altM !== undefined) lines.push('      <altitudeMode>absolute</altitudeMode>')
    lines.push(`      <coordinates>${formatCoord(t, altM)}</coordinates>`, '    </Point>', '  </Placemark>')
  })
  if (path) {
    lines.push(
      '  <Placemark>',
      '    <styleUrl>#wtm-path</styleUrl>',
      '    <LineString>',
      '      <tessellate>1</tessellate>',
      `      <coordinates>${path.map((p) => formatCoord(p)).join(' ')}</coordinates>`,
      '    </LineString>',
      '  </Placemark>',
    )
  }
  lines.push('</Document>', '</kml>', '')
  return lines.join('\n')
}
