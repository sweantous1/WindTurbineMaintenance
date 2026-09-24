# Сторонние материалы

Приложение использует чужие данные и модели. Ниже — что именно, откуда и на каких условиях.
Если меняете или заменяете что-то из этого списка, обновите файл.

## Данные

| Что | Где в приложении | Источник и лицензия |
| --- | --- | --- |
| Карта (тайлы) | Маршруты, 3D-облёт (карта на земле) | © участники [OpenStreetMap](https://www.openstreetmap.org/copyright), данные — ODbL 1.0. Тайлы с `tile.openstreetmap.org` запрашиваются по [правилам использования](https://operations.osmfoundation.org/policies/tiles/): приложение представляется своим User-Agent (см. `electron/main.ts`), в 3D берёт не больше 64 тайлов на ферму |
| Прогноз погоды и геокодинг | Погода, прогноз полёта | [Open-Meteo](https://open-meteo.com/), данные — CC BY 4.0. Бесплатный API только для некоммерческого использования; для коммерческого нужен платный тариф Open-Meteo |

## Модели

| Что | Файлы | Источник и лицензия |
| --- | --- | --- |
| Модель дрона | `public/models/drone/drone.glb` | «Drone» — [liz3d](https://sketchfab.com/mazapan3d), [Sketchfab](https://sketchfab.com/3d-models/drone-19d310dec81c446fba1a797903e083eb), CC BY 4.0. Изменения: один GLB, текстуры 256 px в WebP, квантованные вершины. Атрибуция показывается на экране 3D-облёта. Подробнее — `public/models/drone/LICENSE.txt` |
| Модель поиска дефектов | `public/models/defects/model.onnx`, `manifest.json` | Веса `best_turbine.pt` из учебного проекта Grant-temp (codeberg.org/user00101/Grant-temp), выданного команде как пример для работы. Архитектура YOLO11 от [Ultralytics](https://github.com/ultralytics/ultralytics), AGPL-3.0: при распространении приложения с этой моделью действуют условия AGPL-3.0 либо нужна коммерческая лицензия Ultralytics. Модель переведена в ONNX (opset 18), веса fp16 |

## Библиотеки

Все npm-зависимости перечислены в `package.json`; их лицензии — в `node_modules/<пакет>/LICENSE`.
Основные: React, react-router, i18next (MIT), Leaflet (BSD-2-Clause), three.js, @react-three/fiber, @react-three/drei (MIT),
onnxruntime-web (MIT), Dexie (Apache-2.0), recharts (MIT), exifr (MIT), zod (MIT), Electron (MIT).
