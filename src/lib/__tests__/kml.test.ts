// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { strToU8, unzipSync, zipSync } from 'fflate'
import type { Farm, Turbine } from '@/domain/types'
import { DEFAULT_FARM_DEFAULTS } from '@/domain/defaults'
import { centroid, offsetGeo } from '@/lib/geo'
import { diffTurbines, farmFromImport, farmToKml, KmlImportError, parseKmlText, readFarmFile, sha256Hex, type FarmImport } from '@/lib/kml'
import nestedFoldersKml from './fixtures/nested-folders.kml?raw'
import multiGeometryKml from './fixtures/multigeometry.kml?raw'
import altitudeModesKml from './fixtures/altitude-modes.kml?raw'

const BASE = { lat: 52.02, lon: 18.5 }
const RAD = Math.PI / 180

// coords — как в KML: «долгота,широта[,высота]»
function placemark(name: string | null, coords: string, altitudeMode?: string): string {
  const nameTag = name === null ? '' : `<name>${name}</name>`
  const modeTag = altitudeMode ? `<altitudeMode>${altitudeMode}</altitudeMode>` : ''
  return `<Placemark>${nameTag}<Point>${modeTag}<coordinates>${coords}</coordinates></Point></Placemark>`
}

function lonLat(p: { lat: number; lon: number }): string {
  return `${p.lon},${p.lat}`
}

// fflate типизирует результат как Uint8Array<ArrayBufferLike>, а File нужен буфер ArrayBuffer
function fileOf(bytes: Uint8Array, name: string): File {
  return new File([new Uint8Array(bytes)], name)
}

function kmlDoc(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>${body}</Document></kml>`
}

function expectImportError(fn: () => unknown, code: KmlImportError['code']): void {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(KmlImportError)
    expect((error as KmlImportError).code).toBe(code)
    return
  }
  throw new Error(`Ожидалась ошибка ${code}`)
}

async function expectImportRejection(promise: Promise<unknown>, code: KmlImportError['code']): Promise<void> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(KmlImportError)
  expect((error as KmlImportError).code).toBe(code)
}

// Кириллица А–я и Ёё в windows-1251; остальное — ASCII
function toCp1251(text: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(
    Array.from(text, (ch) => {
      const c = ch.charCodeAt(0)
      if (c < 0x80) return c
      if (c >= 0x410 && c <= 0x44f) return 0xc0 + (c - 0x410)
      if (ch === 'Ё') return 0xa8
      if (ch === 'ё') return 0xb8
      throw new Error(`Символ ${ch} не поддержан в тестовом кодировщике`)
    }),
  )
}

describe('parseKmlText', () => {
  it('берёт точки из вложенных папок и пропускает линии, полигоны, точки вне диапазона и метки без геометрии', () => {
    const result = parseKmlText(nestedFoldersKml)
    expect(result.name).toBe('Ветропарк «Север» & Co')
    expect(result.turbines.map((t) => t.id)).toEqual(['WTG-01', 'WTG-02', 'WTG-03', 'WTG-04'])
    expect(result.turbines.map((t) => t.name)).toEqual(['WTG-01', 'WTG-02', 'WTG-03', 'WTG-04'])
    expect(result.turbines[3]).toEqual({ id: 'WTG-04', name: 'WTG-04', lat: 52.029, lon: 18.512 })
    expect(result.skipped).toBe(4)
    expect(result.merged).toBe(0)
  })

  it('каждая точка MultiGeometry — отдельная турбина; повтор имён даёт id по порядку', () => {
    const result = parseKmlText(multiGeometryKml)
    expect(result.turbines).toEqual([
      { id: 't1', name: 'Ряд Б', lat: 52.1, lon: 18.6 },
      { id: 't2', name: 'Ряд Б', lat: 52.1, lon: 18.604 },
      { id: 't3', name: 'Ряд Б', lat: 52.1, lon: 18.608 },
      { id: 't4', name: 'WTG-10', lat: 52.1, lon: 18.612 },
    ])
    expect(result.skipped).toBe(1)
  })

  it('высота земли — только из точки с altitudeMode absolute, altitudeMode у LookAt не в счёт', () => {
    const byName = new Map(parseKmlText(altitudeModesKml).turbines.map((t) => [t.name, t]))
    expect(byName.get('absolute')?.groundAltM).toBe(112.5)
    for (const name of ['clampToGround', 'relativeToGround', 'lookAtOnly', 'gxSeaFloor', 'absoluteNoAlt']) {
      expect(byName.get(name)).toBeDefined()
      expect(byName.get(name)).not.toHaveProperty('groundAltM')
    }
  })

  it('метка без имени получает T{n}, а id всех турбин — по порядку', () => {
    const result = parseKmlText(kmlDoc(placemark('A', '18.5,52.02') + placemark(null, '18.51,52.02') + placemark('  ', '18.52,52.02')))
    expect(result.turbines.map((t) => [t.id, t.name])).toEqual([
      ['t1', 'A'],
      ['t2', 'T2'],
      ['t3', 'T3'],
    ])
    expect(result.name).toBeUndefined()
  })

  it('сливает точки ближе 5 м к уже принятой и после слияния берёт id из имён', () => {
    const copy = offsetGeo(BASE, 0, 1)
    const near = offsetGeo(BASE, 3, 3)
    const far = offsetGeo(BASE, 6, 0)
    const text = kmlDoc(
      placemark('A', lonLat(BASE)) +
        placemark('A', `${lonLat(copy)},140`, 'absolute') +
        placemark('B', lonLat(near)) +
        placemark('C', lonLat(far)),
    )
    const result = parseKmlText(text)
    expect(result.merged).toBe(2)
    expect(result.turbines.map((t) => t.id)).toEqual(['A', 'C'])
    // Принятая точка сохраняет свои координаты, но получает высоту из дубля, если своей нет
    expect(result.turbines[0]).toEqual({ id: 'A', name: 'A', lat: BASE.lat, lon: BASE.lon, groundAltM: 140 })
  })

  it('без точек-турбин — понятная ошибка', () => {
    const onlyLine = kmlDoc('<Placemark><name>Дорога</name><LineString><coordinates>18.5,52 18.6,52</coordinates></LineString></Placemark>')
    expectImportError(() => parseKmlText(onlyLine), 'noTurbines')
    expect(() => parseKmlText(onlyLine)).toThrow('В файле нет точек-турбин')
    expectImportError(() => parseKmlText(kmlDoc('')), 'noTurbines')
  })

  it('битый XML — ошибка разбора, а не пустая ферма', () => {
    expectImportError(() => parseKmlText('<kml><Document><Placemark></Docu'), 'invalidXml')
    expectImportError(() => parseKmlText('это вообще не XML'), 'invalidXml')
  })

  it('имя турбины — собственный <name> метки: поля ExtendedData его не подменяют', () => {
    const extended = kmlDoc(
      '<Schema name="s" id="s"><SimpleField name="name" type="int"/></Schema>' +
        '<Placemark><name>WTG-01</name><ExtendedData><Data name="name"><value>другое</value></Data></ExtendedData>' +
        '<Point><coordinates>18.5,52.02</coordinates></Point></Placemark>' +
        '<Placemark><name>WTG-02</name><ExtendedData><SchemaData schemaUrl="#s"><SimpleData name="name">7</SimpleData></SchemaData></ExtendedData>' +
        '<Point><coordinates>18.51,52.02</coordinates></Point></Placemark>' +
        // Без своего <name> — T{n}, даже если имя есть в ExtendedData
        '<Placemark><ExtendedData><Data name="name"><value>из данных</value></Data></ExtendedData>' +
        '<Point><coordinates>18.52,52.02</coordinates></Point></Placemark>',
    )
    expect(parseKmlText(extended).turbines.map((t) => [t.id, t.name])).toEqual([
      ['t1', 'WTG-01'],
      ['t2', 'WTG-02'],
      ['t3', 'T3'],
    ])
  })

  it('id — имя без пробелов по краям; внутренние пробелы и регистр различают турбины', () => {
    const text = kmlDoc(
      placemark('\n  WTG  1\t', '18.5,52.02') + placemark('WTG 1', '18.51,52.02') + placemark('wtg 1', '18.52,52.02'),
    )
    expect(parseKmlText(text).turbines.map((t) => t.id)).toEqual(['WTG  1', 'WTG 1', 'wtg 1'])
  })

  it('граница диапазона координат: ±90 и ±180 принимаются, дальше — skipped', () => {
    const text = kmlDoc(
      placemark('S', '10,-90') +
        placemark('E', '180,10') +
        placemark('W', '-180,20') +
        placemark('lat', '10,90.0001') +
        placemark('lon', '-180.0001,30') +
        placemark('inf', 'Infinity,30') +
        placemark('пробелы', ' 18.5 , 52.02 , 7 ', 'absolute'),
    )
    const result = parseKmlText(text)
    expect(result.turbines.map((t) => t.id)).toEqual(['S', 'E', 'W', 'пробелы'])
    expect(result.turbines[3]).toEqual({ id: 'пробелы', name: 'пробелы', lat: 52.02, lon: 18.5, groundAltM: 7 })
    expect(result.skipped).toBe(3)
  })

  it('порог слияния — строго меньше 5 м, дубль уходит в первую принятую точку, а не в ближайшую', () => {
    const b = offsetGeo(BASE, 8, 0)
    const text = kmlDoc(
      placemark('A', lonLat(BASE)) +
        placemark('B', lonLat(b)) +
        // 4,5 м от A и 3,5 м от B: сливается с A, потому что A принята раньше
        placemark('C', `${lonLat(offsetGeo(BASE, 4.5, 0))},150`, 'absolute') +
        placemark('D', lonLat(offsetGeo(BASE, 0, 4.9))) +
        placemark('E', lonLat(offsetGeo(BASE, 0, -5.1))),
    )
    const result = parseKmlText(text)
    // Куда ушёл дубль, видно по высоте: её получает точка, в которую он слился
    expect(result.turbines.map((t) => [t.id, t.groundAltM])).toEqual([
      ['A', 150],
      ['B', undefined],
      ['E', undefined],
    ])
    expect(result.merged).toBe(2)
  })

  it('дубль у границы широтных полос тоже уходит в первую принятую точку', () => {
    // C в 2 м южнее границы полос (шаг 1e-4°), B — по другую сторону границы; обе в 4 м от C
    const c = offsetGeo({ lat: 52.0201, lon: 18.5 }, 0, -2)
    const text = kmlDoc(
      placemark('A', lonLat(offsetGeo(c, 0, -4))) + placemark('B', lonLat(offsetGeo(c, 0, 4))) + placemark('C', `${lonLat(c)},150`, 'absolute'),
    )
    const result = parseKmlText(text)
    expect(result.merged).toBe(1)
    expect(result.turbines.map((t) => [t.id, t.groundAltM])).toEqual([
      ['A', 150],
      ['B', undefined],
    ])
  })

  it('слияние находит дубли на любой широте и через границу широтных полос', () => {
    // Сетка 20 м, у каждой второй турбины дубль в 2–3 м в разную сторону; ложных слияний быть не должно
    const bodies: string[] = []
    let duplicates = 0
    const origins = [
      { lat: 0.00009, lon: 10 },
      { lat: -0.00012, lon: -10 },
      { lat: 52.0199, lon: 18.5 },
      { lat: 69.99995, lon: 30 },
      { lat: -45.00003, lon: 179.99 },
    ]
    origins.forEach((origin, o) => {
      for (let i = 0; i < 12; i++) {
        for (let j = 0; j < 12; j++) {
          const p = offsetGeo(origin, i * 20, j * 20)
          bodies.push(placemark(`o${o}-${i}-${j}`, lonLat(p)))
          if ((i + j) % 2 === 0) {
            const az = (i * 12 + j) * 37 * RAD
            const r = 2 + ((i + j) % 3) * 0.5
            bodies.push(placemark(`o${o}-${i}-${j}-копия`, lonLat(offsetGeo(p, r * Math.sin(az), r * Math.cos(az)))))
            duplicates++
          }
        }
      }
    })
    const result = parseKmlText(kmlDoc(bodies.join('')))
    expect(result.merged).toBe(duplicates)
    expect(result.turbines).toHaveLength(origins.length * 144)
    expect(result.turbines.every((t) => !t.id.endsWith('-копия'))).toBe(true)
  })

  it('GroundOverlay и NetworkLink идут в skipped и не сбивают сопоставление точек', () => {
    const text = kmlDoc(
      '<GroundOverlay><name>Снимок</name><Icon><href>a.png</href></Icon>' +
        '<LatLonBox><north>52.1</north><south>52</south><east>18.6</east><west>18.4</west></LatLonBox></GroundOverlay>' +
        placemark('A', '18.5,52.02,99', 'absolute') +
        '<NetworkLink><name>Ссылка</name><Link><href>other.kml</href></Link></NetworkLink>',
    )
    const result = parseKmlText(text)
    expect(result.turbines).toEqual([{ id: 'A', name: 'A', lat: 52.02, lon: 18.5, groundAltM: 99 }])
    expect(result.skipped).toBe(2)
  })
})

describe('readFarmFile', () => {
  it('читает .kml и считает SHA-256 от байтов файла', async () => {
    const bytes = new TextEncoder().encode(nestedFoldersKml)
    const imp = await readFarmFile(new File([bytes], 'north.kml'))
    expect(imp.fileName).toBe('north.kml')
    expect(imp.turbines).toHaveLength(4)
    expect(imp.skipped).toBe(4)
    const expected = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) => b.toString(16).padStart(2, '0')).join('')
    expect(imp.sha256).toBe(expected)
    expect(imp.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('читает KMZ: берёт doc.kml, игнорирует служебные файлы macOS и картинки', async () => {
    const zip = zipSync({
      '__MACOSX/._doc.kml': new Uint8Array([0, 1, 2]),
      'files/icon.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      'layers/extra.kml': strToU8(kmlDoc(placemark('X', '10,10'))),
      'doc.kml': strToU8(multiGeometryKml),
    })
    const imp = await readFarmFile(fileOf(zip, 'rows.kmz'))
    expect(imp.name).toBe('Ряды')
    expect(imp.turbines).toHaveLength(4)
    expect(imp.fileName).toBe('rows.kmz')
    expect(imp.sha256).toBe(await sha256Hex(new Uint8Array(zip)))
  })

  it('KMZ без doc.kml — берёт .kml из корня архива', async () => {
    const zip = zipSync({ 'nested/other.kml': strToU8(kmlDoc(placemark('X', '10,10'))), 'farm.kml': strToU8(nestedFoldersKml) })
    const imp = await readFarmFile(fileOf(zip, 'farm.kmz'))
    expect(imp.turbines.map((t) => t.id)).toEqual(['WTG-01', 'WTG-02', 'WTG-03', 'WTG-04'])
  })

  it('тип файла определяется по содержимому, а не по расширению', async () => {
    const zip = zipSync({ 'doc.kml': strToU8(nestedFoldersKml) })
    const imp = await readFarmFile(fileOf(zip, 'misnamed.kml'))
    expect(imp.turbines).toHaveLength(4)
  })

  it('KMZ без .kml и повреждённый архив — понятные ошибки', async () => {
    const noKml = zipSync({ 'files/icon.png': new Uint8Array([1, 2, 3]) })
    await expectImportRejection(readFarmFile(fileOf(noKml, 'empty.kmz')), 'kmzNoKml')
    const broken = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8])
    await expectImportRejection(readFarmFile(fileOf(broken, 'broken.kmz')), 'kmzBroken')
  })

  it('учитывает кодировку из XML-декларации (windows-1251)', async () => {
    const text = `<?xml version="1.0" encoding="windows-1251"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Ветропарк Ёлкино</name>${placemark('Ветряк 1', '18.5,52.02')}</Document></kml>`
    const imp = await readFarmFile(new File([toCp1251(text)], 'cp1251.kml'))
    expect(imp.name).toBe('Ветропарк Ёлкино')
    expect(imp.turbines[0].name).toBe('Ветряк 1')
  })

  it('понимает UTF-8 с BOM', async () => {
    const body = new TextEncoder().encode(kmlDoc(placemark('Турбина', '18.5,52.02')))
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...body])
    const imp = await readFarmFile(new File([withBom], 'bom.kml'))
    expect(imp.turbines[0].id).toBe('Турбина')
  })

  it('понимает UTF-16 LE и BE с BOM', async () => {
    const text = kmlDoc(placemark('Ветряк Ё', '18.5,52.02')).replace('UTF-8', 'UTF-16')
    for (const littleEndian of [true, false]) {
      const bytes = new Uint8Array(2 + text.length * 2)
      const view = new DataView(bytes.buffer)
      view.setUint16(0, 0xfeff, littleEndian)
      for (let i = 0; i < text.length; i++) view.setUint16(2 + i * 2, text.charCodeAt(i), littleEndian)
      const imp = await readFarmFile(new File([bytes], 'utf16.kml'))
      expect(imp.turbines.map((t) => t.id)).toEqual(['Ветряк Ё'])
    }
  })

  it('объявленная UTF-16 без BOM в однобайтовом файле читается как UTF-8', async () => {
    const text = kmlDoc(placemark('Ветряк', '18.5,52.02')).replace('UTF-8', 'UTF-16')
    const imp = await readFarmFile(new File([new TextEncoder().encode(text)], 'liar.kml'))
    expect(imp.turbines[0].id).toBe('Ветряк')
  })

  it('пустой архив — «нет .kml», а не ошибка XML', async () => {
    await expectImportRejection(readFarmFile(fileOf(zipSync({}), 'empty.kmz')), 'kmzNoKml')
  })

  it('распаковывает только основной .kml: битый второстепенный .kml не мешает', async () => {
    const zip = zipSync({ 'layers/broken.kml': strToU8(kmlDoc(placemark('X', '10,10'))), 'doc.kml': strToU8(nestedFoldersKml) })
    // Первая запись архива — broken.kml; портим начало её сжатых данных (недопустимый тип блока deflate)
    const view = new DataView(zip.buffer, zip.byteOffset)
    expect(view.getUint32(0, true)).toBe(0x04034b50)
    zip[30 + view.getUint16(26, true) + view.getUint16(28, true)] = 0xff
    // Порча настоящая: распаковать архив целиком уже нельзя
    expect(() => unzipSync(zip)).toThrow()
    const imp = await readFarmFile(fileOf(zip, 'farm.kmz'))
    expect(imp.turbines.map((t) => t.id)).toEqual(['WTG-01', 'WTG-02', 'WTG-03', 'WTG-04'])
  })

  it('слишком большой doc.kml — ошибка, а не молчаливый импорт другого .kml из архива', async () => {
    const zip = zipSync({ 'doc.kml': strToU8(nestedFoldersKml), 'other.kml': strToU8(multiGeometryKml) })
    // В оглавлении архива (PK\x01\x02) у doc.kml объявляем распакованный размер больше 100 МБ
    const view = new DataView(zip.buffer, zip.byteOffset)
    let patched = false
    for (let off = 0; off + 46 <= zip.length; off++) {
      if (view.getUint32(off, true) !== 0x02014b50) continue
      const nameLen = view.getUint16(off + 28, true)
      if (new TextDecoder().decode(zip.subarray(off + 46, off + 46 + nameLen)) === 'doc.kml') {
        view.setUint32(off + 24, 100 * 1024 * 1024 + 1, true)
        patched = true
      }
    }
    expect(patched).toBe(true)
    await expectImportRejection(readFarmFile(fileOf(zip, 'huge.kmz')), 'tooLarge')
  })

  it('файл больше 50 МБ и ошибка чтения — понятные ошибки', async () => {
    const huge = new File([kmlDoc(placemark('A', '18.5,52.02'))], 'huge.kml')
    Object.defineProperty(huge, 'size', { value: 50 * 1024 * 1024 + 1 })
    await expectImportRejection(readFarmFile(huge), 'tooLarge')
    const unreadable = new File([kmlDoc(placemark('A', '18.5,52.02'))], 'gone.kml')
    Object.defineProperty(unreadable, 'arrayBuffer', { value: () => Promise.reject(new DOMException('Файл удалён', 'NotFoundError')) })
    await expectImportRejection(readFarmFile(unreadable), 'readFailed')
  })
})

describe('sha256Hex', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('совпадает с эталонными значениями', async () => {
    const enc = new TextEncoder()
    expect(await sha256Hex(enc.encode(''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(await sha256Hex(enc.encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('без crypto.subtle (веб-версия по http) считает то же самое', async () => {
    const samples = [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000].map((len) => Uint8Array.from({ length: len }, (_, i) => (i * 31 + len) & 0xff))
    const expected = await Promise.all(samples.map((s) => sha256Hex(s)))
    vi.stubGlobal('crypto', {})
    expect(globalThis.crypto.subtle).toBeUndefined()
    const actual = await Promise.all(samples.map((s) => sha256Hex(s)))
    expect(actual).toEqual(expected)
    expect(await sha256Hex(new TextEncoder().encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    )
  })
})

describe('farmFromImport', () => {
  const imp: FarmImport = {
    name: 'Ряды',
    turbines: [
      { id: 'a', name: 'A', lat: 52, lon: 18.5 },
      { id: 'b', name: 'B', lat: 52.01, lon: 18.52, groundAltM: 120 },
    ],
    skipped: 0,
    merged: 0,
    fileName: 'rows.kml',
    sha256: 'f'.repeat(64),
  }

  it('центр — центроид турбин, настройки по умолчанию, источник файла', () => {
    const farm = farmFromImport(imp)
    expect(farm.center).toEqual(centroid(imp.turbines))
    expect(farm.defaults).toEqual(DEFAULT_FARM_DEFAULTS)
    expect(farm.defaults).not.toBe(DEFAULT_FARM_DEFAULTS)
    expect(farm.name).toBe('Ряды')
    expect(farm.turbines).toEqual(imp.turbines)
    // Ферма не делит объекты с результатом импорта: правка турбины не меняет импорт задним числом
    expect(farm.turbines[0]).not.toBe(imp.turbines[0])
    expect(farm.source?.fileName).toBe('rows.kml')
    expect(farm.source?.sha256).toBe('f'.repeat(64))
    expect(Number.isNaN(Date.parse(farm.source?.importedAt ?? ''))).toBe(false)
  })

  it('берёт настройки и имя из прежней фермы', () => {
    const previous: Farm = {
      name: 'Старая',
      center: { lat: 0, lon: 0 },
      defaults: { hubHeightM: 80, rotorDiameterM: 90, safeDistanceM: 40 },
      turbines: [],
    }
    const farm = farmFromImport({ ...imp, name: undefined }, previous)
    expect(farm.defaults).toEqual(previous.defaults)
    expect(farm.name).toBe('Старая')
    expect(farmFromImport(imp, previous).name).toBe('Ряды')
  })

  it('пустой импорт — ошибка', () => {
    expectImportError(() => farmFromImport({ ...imp, turbines: [] }), 'noTurbines')
  })
})

describe('diffTurbines', () => {
  it('считает добавленные, удалённые и сдвинутые больше чем на 1 м', () => {
    const a: Turbine = { id: 'a', name: 'A', ...BASE }
    const b: Turbine = { id: 'b', name: 'B', ...offsetGeo(BASE, 300, 0) }
    const c: Turbine = { id: 'c', name: 'C', ...offsetGeo(BASE, 600, 0) }
    const next: Turbine[] = [
      { ...a, ...offsetGeo(a, 0.5, 0) },
      { ...b, ...offsetGeo(b, 0, 2) },
      { id: 'd', name: 'D', ...offsetGeo(BASE, 900, 0) },
    ]
    expect(diffTurbines([a, b, c], next)).toEqual({ added: 1, removed: 1, moved: 1 })
    expect(diffTurbines([a, b], [a, b])).toEqual({ added: 0, removed: 0, moved: 0 })
    expect(diffTurbines([], [a])).toEqual({ added: 1, removed: 0, moved: 0 })
  })
})

describe('farmToKml', () => {
  const farm: Farm = {
    name: 'Ферма',
    center: BASE,
    defaults: DEFAULT_FARM_DEFAULTS,
    turbines: [
      { id: 'WTG-1', name: 'WTG-1', lat: 52.0212345678, lon: 18.5012345678, groundAltM: 112.25 },
      { id: 'A&B <"x"> \'q\'', name: 'A&B <"x"> \'q\'', lat: 52.03, lon: 18.51 },
      { id: 'WTG-3', name: 'WTG-3', lat: 52.04, lon: 18.49 },
    ],
  }

  it('разбирается обратно в те же турбины', () => {
    const text = farmToKml(farm, { name: 'Облёт & отчёт', path: [BASE, { lat: 52.03, lon: 18.51 }, { lat: 52.04, lon: 18.49 }] })
    expect(text.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(text).toContain('<kml xmlns="http://www.opengis.net/kml/2.2">')
    const parsed = parseKmlText(text)
    expect(parsed.name).toBe('Облёт & отчёт')
    expect(parsed.skipped).toBe(1)
    expect(parsed.merged).toBe(0)
    expect(parsed.turbines).toHaveLength(farm.turbines.length)
    parsed.turbines.forEach((t, i) => {
      const src = farm.turbines[i]
      expect(t.id).toBe(src.id)
      expect(t.name).toBe(src.name)
      expect(t.lat).toBeCloseTo(src.lat, 7)
      expect(t.lon).toBeCloseTo(src.lon, 7)
      expect(t.groundAltM).toBe(src.groundAltM)
    })
  })

  it('номер облёта — в имени, турбины идут в порядке маршрута, устаревшие id не дают дыр', () => {
    const parsed = parseKmlText(farmToKml(farm, { order: ['удалённая', 'WTG-3', 'WTG-1', 'WTG-3'] }))
    expect(parsed.turbines.map((t) => t.name)).toEqual(['1. WTG-3', '2. WTG-1', 'A&B <"x"> \'q\''])
    expect(parsed.name).toBe('Ферма')
    expect(parsed.skipped).toBe(0)
  })

  it('недопустимые в XML символы не ломают файл', () => {
    const odd: Farm = { ...farm, name: 'bad\u0001name\uD800', turbines: [{ id: 'x', name: 'tab\there\u0007', lat: 52, lon: 18 }] }
    const parsed = parseKmlText(farmToKml(odd))
    expect(parsed.name).toBe('badname')
    expect(parsed.turbines[0].name).toBe('tab\there')
  })

  it('переводы строк и двойные пробелы внутри имени переживают выгрузку и импорт', () => {
    const names = ['WTG  1', 'Ряд\r\nА', 'Ряд\rБ', 'Ряд\nВ', 'Ветряк 😀']
    const turbines = names.map((name, i) => ({ id: name, name, ...offsetGeo(BASE, i * 100, 0) }))
    const text = farmToKml({ ...farm, turbines })
    // Парсер XML по стандарту превращает сырой \r в \n (happy-dom этого не делает, браузер — делает),
    // поэтому \r обязан уйти в файл ссылкой на символ
    expect(text).not.toContain('\r')
    const parsed = parseKmlText(text)
    expect(parsed.turbines.map((t) => t.id)).toEqual(names)
    expect(parsed.turbines.map((t) => t.name)).toEqual(names)
  })

  it('структура KML: метки турбин, путь с числом вершин, высота только там, где она есть', () => {
    const path = [BASE, { lat: 52.03, lon: 18.51 }, { lat: 52.04, lon: 18.49 }, BASE]
    const withNaN: Farm = { ...farm, turbines: [...farm.turbines, { id: 'n', name: 'N', lat: 52.05, lon: 18.5, groundAltM: Number.NaN }] }
    const text = farmToKml(withNaN, { order: ['WTG-3'], path })
    expect(text).not.toContain('NaN')
    const doc = new DOMParser().parseFromString(text, 'application/xml')
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0)
    expect(doc.documentElement.namespaceURI).toBe('http://www.opengis.net/kml/2.2')
    const placemarks = Array.from(doc.getElementsByTagName('Placemark'))
    expect(placemarks).toHaveLength(withNaN.turbines.length + 1)
    expect(placemarks.map((p) => p.getElementsByTagName('name')[0]?.textContent ?? null)).toEqual([
      '1. WTG-3',
      'WTG-1',
      'A&B <"x"> \'q\'',
      'N',
      null,
    ])
    expect(doc.getElementsByTagName('altitudeMode')).toHaveLength(1)
    const line = doc.getElementsByTagName('LineString')[0]
    expect(line.getElementsByTagName('coordinates')[0].textContent?.trim().split(/\s+/)).toHaveLength(path.length)
    expect(parseKmlText(text).turbines.find((t) => t.name === 'N')).not.toHaveProperty('groundAltM')
  })

  it('без пути и без имени — только турбины', () => {
    const text = farmToKml({ ...farm, name: undefined })
    expect(text).not.toContain('LineString')
    expect(parseKmlText(text).name).toBeUndefined()
    expect(farmToKml(farm, { path: [BASE] })).not.toContain('LineString')
  })

  it('координаты без экспоненты', () => {
    const tiny: Farm = { ...farm, turbines: [{ id: 'z', name: 'Z', lat: 1e-7, lon: -1e-9 }] }
    const text = farmToKml(tiny)
    expect(text).toContain('<coordinates>0,0.0000001</coordinates>')
  })
})
