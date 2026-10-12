WTM - Wind Turbine Maintenance

Приложение для облёта ветряков дроном: миссии, маршрут по KML, погода и окно вылета, 3D-облёт, поиск дефектов на фото, история.
Бэкенд не нужен, всё хранится локально у пользователя.


Быстрый запуск

1. Поставить Node.js (LTS): https://nodejs.org
2. Скачать проект (git clone или Code -> Download ZIP)
3. В папке проекта открыть терминал и ввести:

```
npm install
npm run dev
```

4. Открыть в браузере http://localhost:5173

В окне Electron: `npm run dev:electron`


Перед пушем

`npm run check` - типы, линтер, тесты и сборка, всё должно пройти


Установщик

`npm run build:electron` - exe появится в папке release

Если падает с EPERM на win-unpacked.tmp (это антивирус мешает), собрать так:

```
npx electron-builder -c.electronDist=node_modules/electron/dist
```


Структура папок

```
src/
├── pages/       - экраны
├── features/    - части экранов по разделам: маршрут, погода, 3D, дефекты и т.д.
├── components/  - общие кнопки, карточки, модалки
├── domain/      - логика без интерфейса: план полёта, погода, маршрут, детекция
├── lib/         - координаты, разбор KML
├── storage/     - IndexedDB: миссии, фото, находки
├── services/    - Open-Meteo, запуск расчёта маршрута и детекции
├── workers/     - фоновые потоки
├── hooks/       - хуки для данных
└── i18n/        - переводы ru/en
electron/        - окно приложения
public/models/   - модель дефектов и модель дрона
```


Кому что смотреть

- Фронтенд - src/pages/, src/features/, src/components/
- Логика - src/domain/, src/lib/
- Дизайнер - src/pages/, src/features/

Откуда взяты карта, погода и модели - в ATTRIBUTION.md
