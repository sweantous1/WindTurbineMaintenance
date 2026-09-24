import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'react-toastify'
import Button from '@/components/common/Button'
import ReadOnlyBanner from '@/components/mission/ReadOnlyBanner'
import RequireMission from '@/components/mission/RequireMission'
import { effectiveLimits } from '@/domain/flightCheck'
import { canEdit } from '@/domain/missionStatus'
import type { Farm, FarmDefaults, GeoPoint, Mission, MissionPatch, RoutePlan } from '@/domain/types'
import { useMissionDrone } from '@/hooks/useMissions'
import { KmlImportError, readFarmFile, type FarmImport } from '@/lib/kml'
import { SolveCancelledError, solveInWorker, type SolveHandle } from '@/services/routeSolver'
import { MissionLockedError, missions } from '@/storage/missions'
import EmptyFarmState from '@/features/route/EmptyFarmState'
import FarmDefaultsForm from '@/features/route/FarmDefaultsForm'
import FileDropArea from '@/features/route/FileDropArea'
import ImportFarmDialog from '@/features/route/ImportFarmDialog'
import OptimizerSettings, { type SolvingState } from '@/features/route/OptimizerSettings'
import OrderList from '@/features/route/OrderList'
import RouteMap, { type MapFocus } from '@/features/route/RouteMap'
import RouteSummary from '@/features/route/RouteSummary'
import UndoToast from '@/features/route/UndoToast'
import { addTurbine, importPatch, moveTurbine, removeTurbine, setFarmDefaults } from '@/features/route/farmEdit'
import { formatKm } from '@/features/route/format'
import { normalizeParams, sameSettings, settingsFromRoute } from '@/features/route/optimizerParams'
import { exportFileName, routeExportJson, routeExportKml } from '@/features/route/routeExport'
import {
  altitudePatch,
  cleanOrder,
  effectiveTakeoff,
  farmEditPatch,
  lengthDrifted,
  moveIdInOrder,
  orderPatch,
  planFor,
  routeContext,
  routeFromSolve,
  solveSignature,
  takeoffPatch,
  toSolvePoints,
  type OptimizerSettings as Settings,
  type RouteContext,
} from '@/features/route/routeLogic'
import { stateAfter, undoPatch, type FarmState } from '@/features/route/undo'

// Раньше ручной маршрут хранился в localStorage; теперь маршрут — часть миссии в IndexedDB
try {
  localStorage.removeItem('wtm_route_data')
} catch (error) {
  console.warn('Не удалось удалить старый маршрут из localStorage:', error)
}

// Поля миссии, которые правит этот экран; после полёта все они только для чтения
const EDITED_FIELDS = ['farm', 'route', 'takeoff', 'flightAltitudeM'] as const satisfies readonly (keyof MissionPatch)[]

const KML_ACCEPT = '.kml,.kmz,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz'

// Сколько держится уведомление с кнопкой «Отменить»
const UNDO_TOAST_MS = 8000

function downloadText(fileName: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Загрузка стартует асинхронно — ссылку освобождаем с запасом
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export default function Router() {
  return <RequireMission>{(mission) => <RoutePlanner key={mission.id} mission={mission} />}</RequireMission>
}

function RoutePlanner({ mission }: { mission: Mission }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'ru'
  const drone = useMissionDrone(mission)
  const { id: missionId, farm, route, flightAltitudeM } = mission
  const savedTakeoff = mission.takeoff
  const editable = EDITED_FIELDS.every((f) => canEdit(mission.status, f))
  // Потолок — меньшее из ограничений миссии и дрона; пока профиль грузится — ограничение миссии
  const ceilingM = drone ? effectiveLimits(mission.limits, drone).maxAltitudeM : mission.limits.maxAltitudeM
  const turbineCount = farm?.turbines.length ?? 0
  const takeoff = savedTakeoff ?? farm?.center

  const ctx = useMemo<RouteContext | undefined>(
    () => (farm && takeoff ? { farm, takeoff, flightAltitudeM, maxAltitudeM: ceilingM } : undefined),
    [farm, takeoff, flightAltitudeM, ceilingM],
  )
  const order = useMemo(() => (farm && route ? cleanOrder(farm, route.order) : []), [farm, route])
  const plan = useMemo(() => (ctx && route ? planFor(ctx, route.order, route.returnToTakeoff) : undefined), [ctx, route])

  // Черновик настроек оптимизатора: применяется кнопкой «Построить маршрут»
  const [settings, setSettings] = useState<Settings>(() => settingsFromRoute(route))
  const routeSettings = useMemo(() => settingsFromRoute(route), [route])
  const changedFromRoute = !!route && !sameSettings(settings, routeSettings)

  const [addMode, setAddMode] = useState(() => turbineCount === 0)
  const [focus, setFocus] = useState<MapFocus>()
  const [solving, setSolving] = useState<SolvingState | null>(null)
  const solveRef = useRef<SolveHandle | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [reading, setReading] = useState(false)
  const [pendingImport, setPendingImport] = useState<FarmImport | null>(null)
  const [applying, setApplying] = useState(false)

  // Уход с экрана или смена миссии останавливают расчёт: воркер завершается сразу
  useEffect(() => () => solveRef.current?.cancel(), [])

  const reportError = useCallback(
    (error: unknown) => {
      if (error instanceof MissionLockedError) {
        toast.error(t('routePlan.errors.locked'))
        return
      }
      console.error('Не удалось сохранить изменения маршрута:', error)
      toast.error(t('routePlan.errors.saveFailed'))
    },
    [t],
  )

  // Правки идут строго по очереди, и каждая читает миссию из базы заново: иначе две быстрые
  // правки (клики по карте, перестановки) прочли бы одно и то же состояние, и вторая затёрла бы первую.
  // true — патч сохранён; false — сохранять было нечего или не удалось (ошибка уже показана)
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const edit = useCallback(
    (makePatch: (m: Mission) => MissionPatch | null): Promise<boolean> => {
      const run = async () => {
        try {
          const current = await missions.get(missionId)
          if (!current) return false
          const patch = makePatch(current)
          if (!patch) return false
          await missions.update(missionId, patch)
          return true
        } catch (error) {
          reportError(error)
          return false
        }
      }
      const result = queue.current.then(run)
      queue.current = result
      return result
    },
    [missionId, reportError],
  )

  // Перенос и удаление турбины можно отменить: маркер легко сдвинуть случайно, а координаты
  // и высота рельефа из файла после этого пропадают
  const offerUndo = useCallback(
    (message: string, before: FarmState, after: FarmState) => {
      let used = false
      const undo = async () => {
        if (used) return
        used = true
        const outcome = { stale: false }
        const saved = await edit((m) => {
          const patch = undoPatch(m, before, after)
          if (!patch) outcome.stale = true
          return patch
        })
        if (outcome.stale) toast.warn(t('routePlan.undo.stale'))
        else if (saved) toast.info(t('routePlan.undo.done'))
      }
      toast(
        ({ closeToast }) => (
          <UndoToast
            message={message}
            onUndo={() => {
              closeToast()
              void undo()
            }}
          />
        ),
        { autoClose: UNDO_TOAST_MS },
      )
    },
    [edit, t],
  )

  const editFarmUndoable = useCallback(
    (turbineId: string, change: (farm: Farm) => Farm, messageKey: 'routePlan.undo.moved' | 'routePlan.undo.deleted') => {
      const undo: { before?: FarmState; after?: FarmState; name?: string } = {}
      return edit((m) => {
        // Турбину уже удалили в другом окне — менять нечего, маршрут не помечаем изменённым
        const turbine = m.farm?.turbines.find((tb) => tb.id === turbineId)
        if (!m.farm || !turbine) return null
        const patch = farmEditPatch(m, change(m.farm), ceilingM)
        undo.before = { farm: m.farm, route: m.route }
        undo.after = stateAfter(m, patch)
        undo.name = turbine.name
        return patch
      }).then((saved) => {
        if (saved && undo.before && undo.after) offerUndo(t(messageKey, { name: undo.name }), undo.before, undo.after)
        return saved
      })
    },
    [edit, ceilingM, offerUndo, t],
  )

  // Длина в маршруте должна совпадать с планом: высоту или профиль дрона могли поменять
  // на другом экране. Пересчёт идёт по свежей миссии, поэтому повторно не срабатывает
  useEffect(() => {
    if (!editable || !drone || solving || !route || !plan || !lengthDrifted(route, plan)) return
    void edit((m) => {
      const c = routeContext(m, ceilingM)
      if (!m.route || !c) return null
      const fresh = planFor(c, m.route.order, m.route.returnToTakeoff)
      return lengthDrifted(m.route, fresh) ? { route: { ...m.route, lengthM: fresh.lengthM } } : null
    })
  }, [editable, drone, solving, route, plan, edit, ceilingM])

  const handleAddTurbine = useCallback(
    (p: GeoPoint) => void edit((m) => farmEditPatch(m, addTurbine(m.farm, p).farm, ceilingM)),
    [edit, ceilingM],
  )
  const handleMoveTurbine = useCallback(
    (id: string, p: GeoPoint) => editFarmUndoable(id, (f) => moveTurbine(f, id, p), 'routePlan.undo.moved'),
    [editFarmUndoable],
  )
  const handleDeleteTurbine = useCallback(
    (id: string) => void editFarmUndoable(id, (f) => removeTurbine(f, id), 'routePlan.undo.deleted'),
    [editFarmUndoable],
  )
  const handleMoveTakeoff = useCallback((p: GeoPoint) => edit((m) => takeoffPatch(m, p, ceilingM)), [edit, ceilingM])
  const handleShowOnMap = useCallback((turbineId: string) => setFocus((f) => ({ turbineId, nonce: (f?.nonce ?? 0) + 1 })), [])

  const handleFlightAltitude = (altM: number) => void edit((m) => altitudePatch(m, altM, ceilingM))
  const handleFarmDefaults = (patch: Partial<FarmDefaults>) =>
    void edit((m) => (m.farm ? farmEditPatch(m, setFarmDefaults(m.farm, patch), ceilingM) : null))
  const handleMoveInOrder = (turbineId: string, delta: number) =>
    void edit((m) => {
      if (!m.farm || !m.route) return null
      const current = cleanOrder(m.farm, m.route.order)
      const next = moveIdInOrder(current, turbineId, delta)
      // Уже на краю списка — маршрут не трогаем и не помечаем изменённым
      return next.every((id, i) => id === current[i]) ? null : orderPatch(m, next, ceilingM)
    })

  // ---------- Импорт ----------

  const importErrorText = (error: unknown) => {
    if (error instanceof KmlImportError) return t(`routePlan.importErrors.${error.code}`, { defaultValue: error.message })
    console.error('Не удалось импортировать ферму:', error)
    return t('routePlan.importErrors.unknown')
  }

  const handleFiles = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file || reading) return
    if (files.length > 1) toast.info(t('routePlan.import.onlyFirst', { name: file.name }))
    setReading(true)
    try {
      setPendingImport(await readFarmFile(file))
    } catch (error) {
      toast.error(importErrorText(error))
    } finally {
      setReading(false)
    }
  }

  const confirmImport = async ({ moveTakeoff }: { moveTakeoff: boolean }) => {
    const imp = pendingImport
    if (!imp || applying) return
    setApplying(true)
    const saved = await edit((m) => importPatch(m, imp, { moveTakeoff }))
    setApplying(false)
    // Не сохранилось — окно остаётся открытым, ошибка уже показана
    if (!saved) return
    toast.success(t('routePlan.import.done', { count: imp.turbines.length }))
    setPendingImport(null)
    setAddMode(false)
  }

  // ---------- Расчёт ----------

  const handleBuild = async () => {
    if (!ctx || ctx.farm.turbines.length === 0 || solveRef.current) return
    const snapshot = ctx
    const used: Settings = { ...settings, params: normalizeParams(settings.algorithm, settings.params) }
    const handle = solveInWorker(
      {
        points: toSolvePoints(snapshot.farm, snapshot.takeoff),
        closed: used.returnToTakeoff,
        algorithm: used.algorithm,
        params: used.params,
        thetaMaxDeg: used.thetaMaxDeg,
      },
      (progress) => setSolving({ progress }),
    )
    solveRef.current = handle
    setSolving({})
    setAddMode(false)
    try {
      const result = await handle.promise
      const outcome: { stale: boolean; route?: RoutePlan } = { stale: false }
      const saved = await edit((current) => {
        // Пока шёл расчёт, ферму или взлёт могли поменять в другом окне — такой порядок уже не про неё
        const currentTakeoff = effectiveTakeoff(current)
        if (!current.farm || !currentTakeoff || solveSignature(current.farm, currentTakeoff) !== solveSignature(snapshot.farm, snapshot.takeoff)) {
          outcome.stale = true
          return null
        }
        const fresh: RouteContext = { ...snapshot, farm: current.farm, flightAltitudeM: current.flightAltitudeM }
        outcome.route = routeFromSolve(fresh, result, used, new Date().toISOString()).route
        // Точка взлёта, от которой считали, сохраняется: иначе она уедет вместе с центром фермы
        return { route: outcome.route, ...(current.takeoff ? {} : { takeoff: snapshot.takeoff }) }
      })
      if (outcome.stale) {
        toast.warn(t('routePlan.build.farmChanged'))
      } else if (saved && outcome.route) {
        setSettings(used)
        toast.success(t('routePlan.build.done', { km: formatKm(outcome.route.lengthM, lang) }))
      }
    } catch (error) {
      // Сюда доходят только ошибки самого расчёта: сохранение ловит и показывает edit
      if (error instanceof SolveCancelledError) return
      console.error('Расчёт маршрута не удался:', error)
      toast.error(t('routePlan.errors.solveFailed'))
    } finally {
      if (solveRef.current === handle) {
        solveRef.current = null
        setSolving(null)
      }
    }
  }

  const handleCancel = () => solveRef.current?.cancel()

  // ---------- Экспорт ----------

  const exportAs = (ext: 'json' | 'kml') => {
    if (!farm || turbineCount === 0) return
    try {
      const name = exportFileName(t('routePlan.export.fileBase', { mission: mission.name }), ext)
      if (ext === 'json') {
        downloadText(name, routeExportJson({ ...mission, farm }, plan, new Date().toISOString()), 'application/json')
      } else {
        downloadText(name, routeExportKml(farm, route, plan, farm.name ?? mission.name), 'application/vnd.google-earth.kml+xml')
      }
    } catch (error) {
      console.error('Не удалось выгрузить маршрут:', error)
      toast.error(t('routePlan.errors.exportFailed'))
    }
  }

  const pickFile = () => fileInput.current?.click()
  const busy = solving !== null
  const hasTurbines = turbineCount > 0

  return (
    <div className="space-y-6">
      <ReadOnlyBanner mission={mission} />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900">{t('routePlan.title')}</h1>
          <p className="text-gray-500 mt-1 truncate">
            {farm && hasTurbines
              ? [
                  farm.name ?? t('routePlan.unnamedFarm'),
                  t('routePlan.turbines', { count: turbineCount }),
                  farm.source ? t('routePlan.sourceFile', { fileName: farm.source.fileName }) : t('routePlan.manualFarm'),
                ].join(' · ')
              : t('routePlan.subtitle')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {editable && (
            <Button variant="secondary" onClick={pickFile} isLoading={reading} disabled={busy}>
              {t('routePlan.actions.import')}
            </Button>
          )}
          <Button variant="secondary" onClick={() => exportAs('json')} disabled={!hasTurbines}>
            {t('routePlan.actions.exportJson')}
          </Button>
          <Button variant="secondary" onClick={() => exportAs('kml')} disabled={!hasTurbines}>
            {t('routePlan.actions.exportKml')}
          </Button>
          <Button variant="secondary" disabled title={t('routePlan.actions.open3dHint')}>
            {t('routePlan.actions.open3d')}
            <span className="text-[10px] uppercase tracking-wide rounded bg-gray-200 text-gray-600 px-1.5 py-0.5">
              {t('routePlan.actions.soon')}
            </span>
          </Button>
        </div>
      </div>

      {!hasTurbines && <EmptyFarmState editable={editable} reading={reading} onPickFile={pickFile} onFiles={(f) => void handleFiles(f)} />}

      <div className="grid grid-cols-1 min-[960px]:grid-cols-[minmax(0,1fr)_320px] gap-6 items-start">
        <div className="space-y-6 min-w-0">
          <FileDropArea
            enabled={editable && !busy && !reading && !pendingImport}
            onFiles={(f) => void handleFiles(f)}
            overlayText={hasTurbines ? t('routePlan.empty.dropReplace') : t('routePlan.empty.dropHere')}
          >
            <RouteMap
              farm={farm}
              takeoff={takeoff}
              takeoffIsDefault={!savedTakeoff}
              order={order}
              plan={plan}
              fallbackCenter={mission.weather?.location}
              editable={editable && !busy}
              addMode={addMode}
              onAddModeChange={setAddMode}
              onAddTurbine={handleAddTurbine}
              onMoveTurbine={handleMoveTurbine}
              onDeleteTurbine={handleDeleteTurbine}
              onMoveTakeoff={handleMoveTakeoff}
              focus={focus}
            />
          </FileDropArea>
          {farm && hasTurbines && (
            <RouteSummary farm={farm} route={route} plan={plan} drone={drone} flightAltitudeM={flightAltitudeM} ceilingM={ceilingM} />
          )}
        </div>

        <div className="space-y-6">
          <OptimizerSettings
            settings={settings}
            onSettingsChange={setSettings}
            flightAltitudeM={flightAltitudeM}
            onFlightAltitudeChange={handleFlightAltitude}
            ceilingM={ceilingM}
            readOnly={!editable}
            solving={solving}
            buildBlockedReason={!hasTurbines ? t('routePlan.build.needTurbines') : undefined}
            hasRoute={!!route}
            changedFromRoute={changedFromRoute}
            onBuild={() => void handleBuild()}
            onCancel={handleCancel}
          />
          {farm && hasTurbines && (
            <OrderList farm={farm} order={order} disabled={!editable || busy} onMove={handleMoveInOrder} onShow={handleShowOnMap} />
          )}
          {farm && <FarmDefaultsForm defaults={farm.defaults} disabled={!editable || busy} onChange={handleFarmDefaults} />}
        </div>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept={KML_ACCEPT}
        className="hidden"
        onChange={(e) => {
          void handleFiles(e.target.files)
          e.target.value = ''
        }}
      />

      {pendingImport && (
        <ImportFarmDialog
          key={`${pendingImport.sha256}|${pendingImport.fileName}`}
          imp={pendingImport}
          currentFarm={farm}
          takeoff={savedTakeoff}
          hasRoute={!!route}
          busy={applying}
          onCancel={() => setPendingImport(null)}
          onConfirm={(opts) => void confirmImport(opts)}
        />
      )}
    </div>
  )
}
