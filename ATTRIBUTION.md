# Сторонние материалы

Чужие данные, модели и библиотеки, которые использует приложение. Если что-то из списка меняется, файл надо обновить.

## Данные

| Что | Где в приложении | Источник и лицензия |
| --- | --- | --- |
| Карта (тайлы) | Маршруты, 3D-облёт (карта на земле) | © участники [OpenStreetMap](https://www.openstreetmap.org/copyright), данные под ODbL 1.0. Тайлы с `tile.openstreetmap.org` берутся по [правилам использования](https://operations.osmfoundation.org/policies/tiles/): свой User-Agent (см. `electron/main.ts`), в 3D не больше 64 тайлов на ферму |
| Прогноз погоды и геокодинг | Погода, прогноз полёта | [Open-Meteo](https://open-meteo.com/), данные под CC BY 4.0. Бесплатный API только для некоммерческого использования, для коммерческого нужен платный тариф Open-Meteo |

## Модели

| Что | Файлы | Источник и лицензия |
| --- | --- | --- |
| Модель дрона | `public/models/drone/drone.glb` | "Drone", автор [liz3d](https://sketchfab.com/mazapan3d), [Sketchfab](https://sketchfab.com/3d-models/drone-19d310dec81c446fba1a797903e083eb), CC BY 4.0. Изменения: один GLB, текстуры 256 px в WebP, квантованные вершины. Атрибуция выводится на экране 3D-облёта, подробнее в `public/models/drone/LICENSE.txt` |
| Модель поиска дефектов | `public/models/defects/model.onnx`, `manifest.json` | Веса `best_turbine.pt` из учебного проекта Grant-temp (codeberg.org/user00101/Grant-temp), который выдали команде как пример. Архитектура YOLO11 от [Ultralytics](https://github.com/ultralytics/ultralytics), AGPL-3.0: если распространять приложение с этой моделью, действуют условия AGPL-3.0 либо нужна коммерческая лицензия Ultralytics. Переведена в ONNX (opset 18), веса fp16 |

## Библиотеки

Все npm-зависимости в `package.json`, их лицензии в `node_modules/<пакет>/LICENSE`.
Основные: React, react-router, i18next (MIT), Leaflet (BSD-2-Clause), three.js, @react-three/fiber, @react-three/drei (MIT),
onnxruntime-web (MIT), Dexie (Apache-2.0), recharts (MIT), exifr (MIT), zod (MIT), Electron (MIT).
