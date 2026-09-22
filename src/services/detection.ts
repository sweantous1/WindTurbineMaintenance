import * as tf from '@tensorflow/tfjs';
import { v4 as uuidv4 } from 'uuid';
import type { Defect } from '@/types';

// ============================
// 1. Константы
// ============================

const MODEL_URL = '/model.json';

const IMAGE_SIZE = 640;
const CONFIDENCE_THRESHOLD = 0.5;

const CLASS_NAMES = [
  'crack',
  'corrosion',
  'delamination',
  'erosion',
  'lightning',
] as const;

type DefectClass = (typeof CLASS_NAMES)[number];

// ============================
// 2. Загрузка модели (singleton)
// ============================

let model: tf.GraphModel | null = null;
let modelPromise: Promise<tf.GraphModel> | null = null;

async function loadModel(): Promise<tf.GraphModel> {
  if (model !== null) {
    return model;
  }

  if (modelPromise === null) {
    modelPromise = tf.loadGraphModel(MODEL_URL);
  }

  try {
    model = await modelPromise;
    return model;
  } catch (error) {
    modelPromise = null;

    throw new Error(
      `Не удалось загрузить модель: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

// ============================
// 3. Загрузка изображения
// ============================

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (!(file instanceof File)) {
      reject(new Error('Передан некорректный файл'));
      return;
    }

    if (!file.type.startsWith('image/')) {
      reject(new Error('Выбранный файл не является изображением'));
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      const src = reader.result;

      if (typeof src !== 'string') {
        reject(new Error('Не удалось прочитать изображение'));
        return;
      }

      const img = new Image();

      img.onload = () => {
        if (img.naturalWidth === 0 || img.naturalHeight === 0) {
          reject(new Error('Изображение имеет некорректные размеры'));
          return;
        }

        resolve(img);
      };

      img.onerror = () => {
        reject(new Error('Не удалось загрузить изображение'));
      };

      img.src = src;
    };

    reader.onerror = () => {
      reject(new Error('Ошибка чтения файла'));
    };

    reader.readAsDataURL(file);
  });
}

// ============================
// 4. Предобработка изображения
// ============================

function preprocessImage(img: HTMLImageElement): tf.Tensor4D {
  return tf.tidy(() => {
    const tensor = tf.browser.fromPixels(img);

    const resized = tf.image.resizeBilinear(tensor, [
      IMAGE_SIZE,
      IMAGE_SIZE,
    ]);

    return resized
      .toFloat()
      .div(255)
      .expandDims(0) as tf.Tensor4D;
  });
}

// ============================
// 5. Нормализация выходов модели
// ============================

function normalizeOutputs(
  result: tf.Tensor | tf.Tensor[] | tf.NamedTensorMap,
): tf.Tensor[] {
  if (Array.isArray(result)) {
    return result;
  }

  if (result instanceof tf.Tensor) {
    return [result];
  }

  if (result !== null && typeof result === 'object') {
    return Object.values(result);
  }

  throw new Error('Модель вернула неизвестный формат результата');
}

// ============================
// 6. Получение класса по ID
// ============================

function getDefectClass(classId: number): DefectClass | null {
  if (!Number.isInteger(classId)) {
    return null;
  }

  if (classId < 0 || classId >= CLASS_NAMES.length) {
    return null;
  }

  return CLASS_NAMES[classId];
}

// ============================
// 7. Определение степени повреждения
// ============================

function getSeverity(score: number): Defect['severity'] {
  if (score >= 0.8) {
    return 'high';
  }

  if (score >= 0.6) {
    return 'medium';
  }

  return 'low';
}

// ============================
// 8. Ограничение значения диапазоном
// ============================

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ============================
// 9. Постобработка результатов
// ============================

function postprocessOutputs(
  outputs: tf.Tensor[],
  _imgWidth: number,
  _imgHeight: number,
): Defect[] {
  if (outputs.length < 3) {
    throw new Error(
      `Модель вернула ${outputs.length} выходов, ` +
        'а ожидается минимум 3: boxes, scores, classes',
    );
  }

  /*
   * Ожидаемый формат:
   *
   * outputs[0] -> boxes
   * [1, numDetections, 4]
   *
   * outputs[1] -> scores
   * [1, numDetections]
   *
   * outputs[2] -> classes
   * [1, numDetections]
   *
   * boxes:
   * [y1, x1, y2, x2]
   *
   * Координаты предполагаются нормализованными: 0..1
   */

  const boxes = outputs[0].dataSync();
  const scores = outputs[1].dataSync();
  const classes = outputs[2].dataSync();

  if (boxes.length % 4 !== 0) {
    throw new Error(
      `Некорректная форма boxes: ${boxes.length} значений`,
    );
  }

  const numDetections = Math.floor(boxes.length / 4);

  if (scores.length < numDetections) {
    throw new Error(
      `Недостаточно scores: получено ${scores.length}, ` +
        `ожидалось минимум ${numDetections}`,
    );
  }

  if (classes.length < numDetections) {
    throw new Error(
      `Недостаточно classes: получено ${classes.length}, ` +
        `ожидалось минимум ${numDetections}`,
    );
  }

  const defects: Defect[] = [];

  for (let i = 0; i < numDetections; i++) {
    const score = Number(scores[i]);

    if (
      !Number.isFinite(score) ||
      score < CONFIDENCE_THRESHOLD
    ) {
      continue;
    }

    const rawClassId = Number(classes[i]);

    if (!Number.isFinite(rawClassId)) {
      continue;
    }

    const classId = Math.round(rawClassId);

    const defectClass = getDefectClass(classId);

    // Не допускаем неизвестные классы
    if (defectClass === null) {
      console.warn(
        `Модель вернула неизвестный classId: ${classId}`,
      );

      continue;
    }

    const y1 = Number(boxes[i * 4]);
    const x1 = Number(boxes[i * 4 + 1]);
    const y2 = Number(boxes[i * 4 + 2]);
    const x2 = Number(boxes[i * 4 + 3]);

    if (
      !Number.isFinite(x1) ||
      !Number.isFinite(y1) ||
      !Number.isFinite(x2) ||
      !Number.isFinite(y2)
    ) {
      continue;
    }

    // Ограничиваем координаты диапазоном 0..1
    const x = clamp(x1, 0, 1);
    const y = clamp(y1, 0, 1);
    const right = clamp(x2, 0, 1);
    const bottom = clamp(y2, 0, 1);

    const width = right - x;
    const height = bottom - y;

    if (width <= 0 || height <= 0) {
      continue;
    }

    const severity = getSeverity(score);

    defects.push({
      id: uuidv4(),
      type: defectClass,
      severity,
      x,
      y,
      width,
      height,
      confidence: clamp(score, 0, 1),
    });
  }

  return defects;
}

// ============================
// 10. Основная функция анализа
// ============================

export async function analyzeImage(
  file: File,
): Promise<Defect[]> {
  let inputTensor: tf.Tensor4D | null = null;
  let outputTensors: tf.Tensor[] = [];

  try {
    // Загружаем модель
    const loadedModel = await loadModel();

    // Загружаем изображение
    const img = await loadImageFromFile(file);

    // Предобработка
    inputTensor = preprocessImage(img);

    // Инференс
    const result = await loadedModel.executeAsync(
      inputTensor,
    );

    // Приводим результат к массиву Tensor
    outputTensors = normalizeOutputs(result);

    // Постобработка
    return postprocessOutputs(
      outputTensors,
      img.naturalWidth,
      img.naturalHeight,
    );
  } catch (error) {
    console.error(
      'Ошибка при анализе изображения:',
      error,
    );

    // Fallback для тестирования
    return getMockDefects();
  } finally {
    // Освобождаем входной tensor
    inputTensor?.dispose();

    // Освобождаем выходные tensors
    for (const tensor of outputTensors) {
      tensor.dispose();
    }
  }
}

// ============================
// 11. Mock-данные
// ============================

export function getMockDefects(): Defect[] {
  return [
    {
      id: uuidv4(),
      type: 'crack',
      severity: 'high',
      x: 0.15 + Math.random() * 0.3,
      y: 0.15 + Math.random() * 0.3,
      width: 0.1,
      height: 0.05,
      confidence: 0.88 + Math.random() * 0.1,
    },
    {
      id: uuidv4(),
      type: 'corrosion',
      severity: 'medium',
      x: 0.4 + Math.random() * 0.3,
      y: 0.5 + Math.random() * 0.3,
      width: 0.08,
      height: 0.08,
      confidence: 0.78 + Math.random() * 0.12,
    },
    {
      id: uuidv4(),
      type: 'delamination',
      severity: 'medium',
      x: 0.2 + Math.random() * 0.3,
      y: 0.6 + Math.random() * 0.2,
      width: 0.1,
      height: 0.08,
      confidence: 0.75 + Math.random() * 0.15,
    },
    {
      id: uuidv4(),
      type: 'erosion',
      severity: 'low',
      x: 0.6 + Math.random() * 0.3,
      y: 0.1 + Math.random() * 0.3,
      width: 0.12,
      height: 0.06,
      confidence: 0.7 + Math.random() * 0.15,
    },
    {
      id: uuidv4(),
      type: 'lightning',
      severity: 'high',
      x: 0.5 + Math.random() * 0.2,
      y: 0.2 + Math.random() * 0.3,
      width: 0.08,
      height: 0.12,
      confidence: 0.82 + Math.random() * 0.12,
    },
  ];
}