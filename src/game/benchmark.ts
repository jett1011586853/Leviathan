import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { z } from 'zod/v4'
import {
  GAME_OBJECT_CATEGORIES,
  gameFrameLabelsSchema,
  loadGameDataset,
  type GameDatasetSample,
  type GameFrameAnnotation,
  type GameFrameLabels,
  type GameObjectBox,
} from './dataset.js'

const predictionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  sampleId: z.string().regex(/^sample_[a-f0-9]{24}$/),
  detectorId: z.string().min(1).max(200),
  generatedAt: z.string().datetime().optional(),
  labels: gameFrameLabelsSchema,
})

export type GameFramePrediction = z.infer<typeof predictionSchema>

type NumericMetric = {
  count: number
  predicted: number
  missing: number
  meanAbsoluteError?: number
  exactAccuracy?: number
}

type ClassificationMetric = {
  count: number
  correct: number
  accuracy?: number
}

type DetectionMetric = {
  groundTruth: number
  predicted: number
  truePositive: number
  falsePositive: number
  falseNegative: number
  precision?: number
  recall?: number
  f1?: number
}

export type GameBenchmarkEvaluation = {
  schemaVersion: 1
  benchmarkId: string
  datasetId: string
  datasetPath: string
  detectorId: string
  predictionsPath: string
  generatedAt: string
  sampleCounts: {
    total: number
    eligible: number
    reviewed: number
    predicted: number
    missingPrediction: number
    unknownPrediction: number
    imageIntegrityFailures: number
  }
  coverage: number
  phase: ClassificationMetric
  safeToInteract: ClassificationMetric
  ammoCurrent: NumericMetric
  ammoReserve: NumericMetric
  economy: NumericMetric
  health: NumericMetric
  objectiveArrow: {
    count: number
    meanAbsoluteAngularError?: number
    within15Degrees?: number
  }
  detections: {
    iouThreshold: number
    overall: DetectionMetric
    categories: Record<string, DetectionMetric>
  }
  baseline?: {
    benchmarkId: string
    path: string
    deltas: Record<string, number>
    regressions: string[]
  }
  warnings: string[]
}

export async function evaluateGameDatasetBenchmark(input: {
  cwd: string
  datasetPath: string
  predictionsPath: string
  reportPath?: string
  baselineReportPath?: string
}): Promise<{ evaluation: GameBenchmarkEvaluation; reportPath?: string }> {
  const datasetPath = resolveFromCwd(input.cwd, input.datasetPath)
  const predictionsPath = resolveFromCwd(input.cwd, input.predictionsPath)
  const dataset = await loadGameDataset(datasetPath)
  const predictions = parseJsonl(
    await readFile(predictionsPath, 'utf8'),
    predictionSchema,
    'GameModel detector predictions',
  )
  const detectorIds = new Set(predictions.map(prediction => prediction.detectorId))
  if (detectorIds.size !== 1) {
    throw new Error(
      `A benchmark run requires exactly one detectorId; found ${detectorIds.size}.`,
    )
  }
  const detectorId = [...detectorIds][0]!
  const predictionBySample = new Map<string, GameFramePrediction>()
  for (const prediction of predictions) {
    if (predictionBySample.has(prediction.sampleId)) {
      throw new Error(`Duplicate prediction for sample ${prediction.sampleId}.`)
    }
    predictionBySample.set(prediction.sampleId, prediction)
  }
  const sampleById = new Map(dataset.samples.map(sample => [sample.sampleId, sample]))
  const eligibleAnnotations = dataset.annotations.filter(
    annotation =>
      annotation.status === 'annotated' || annotation.status === 'reviewed',
  )
  const phase = createClassificationAccumulator()
  const safeToInteract = createClassificationAccumulator()
  const ammoCurrent = createNumericAccumulator()
  const ammoReserve = createNumericAccumulator()
  const economy = createNumericAccumulator()
  const health = createNumericAccumulator()
  const arrowErrors: number[] = []
  const detectionCategories = Object.fromEntries(
    GAME_OBJECT_CATEGORIES.map(category => [category, emptyDetectionMetric()]),
  ) as Record<string, DetectionMetric>
  let predicted = 0
  let missingPrediction = 0
  let imageIntegrityFailures = 0

  for (const annotation of eligibleAnnotations) {
    const sample = sampleById.get(annotation.sampleId)
    if (!sample) throw new Error(`Annotation references missing sample ${annotation.sampleId}.`)
    if (!(await verifySampleImage(datasetPath, sample))) {
      imageIntegrityFailures += 1
      continue
    }
    const prediction = predictionBySample.get(annotation.sampleId)
    if (!prediction) {
      missingPrediction += 1
      accumulateDetections(
        annotation.labels?.boxes ?? [],
        [],
        detectionCategories,
      )
      continue
    }
    predicted += 1
    const truth = annotation.labels ?? {}
    const guess = prediction.labels
    accumulateClassification(phase, truth.phase, guess.phase)
    accumulateClassification(
      safeToInteract,
      truth.safeToInteract,
      guess.safeToInteract,
    )
    accumulateNumeric(ammoCurrent, truth.ammo?.current, guess.ammo?.current)
    accumulateNumeric(ammoReserve, truth.ammo?.reserve, guess.ammo?.reserve)
    accumulateNumeric(economy, truth.economy, guess.economy)
    accumulateNumeric(health, truth.health, guess.health)
    if (truth.objectiveArrow) {
      arrowErrors.push(
        guess.objectiveArrow
          ? angularError(
              truth.objectiveArrow.angleDeg,
              guess.objectiveArrow.angleDeg,
            )
          : 180,
      )
    }
    accumulateDetections(
      truth.boxes ?? [],
      guess.boxes ?? [],
      detectionCategories,
    )
  }

  const validEligible = eligibleAnnotations.length - imageIntegrityFailures
  const unknownPrediction = predictions.filter(
    prediction => !sampleById.has(prediction.sampleId),
  ).length
  const overallDetections = Object.values(detectionCategories).reduce(
    (total, metric) => mergeDetectionMetric(total, metric),
    emptyDetectionMetric(),
  )
  const warnings: string[] = []
  if (eligibleAnnotations.length === 0) {
    warnings.push('No annotated or reviewed ground-truth samples are available.')
  }
  if (dataset.annotations.some(annotation => annotation.status === 'annotated')) {
    warnings.push('Benchmark includes annotations that have not reached reviewed status.')
  }
  if (imageIntegrityFailures > 0) {
    warnings.push(`${imageIntegrityFailures} sample images failed SHA-256 verification.`)
  }
  if (validEligible > 0 && predicted / validEligible < 0.95) {
    warnings.push('Prediction coverage is below 95%; missing predictions count as misses.')
  }

  const generatedAt = new Date().toISOString()
  const benchmarkSeed = JSON.stringify({
    datasetId: dataset.manifest.datasetId,
    detectorId,
    predictionsSha256: sha256(await readFile(predictionsPath)),
  })
  const evaluation: GameBenchmarkEvaluation = {
    schemaVersion: 1,
    benchmarkId: `benchmark_${sha256(benchmarkSeed).slice(0, 20)}`,
    datasetId: dataset.manifest.datasetId,
    datasetPath,
    detectorId,
    predictionsPath,
    generatedAt,
    sampleCounts: {
      total: dataset.samples.length,
      eligible: eligibleAnnotations.length,
      reviewed: eligibleAnnotations.filter(item => item.status === 'reviewed').length,
      predicted,
      missingPrediction,
      unknownPrediction,
      imageIntegrityFailures,
    },
    coverage: validEligible > 0 ? round4(predicted / validEligible) : 0,
    phase: finalizeClassification(phase),
    safeToInteract: finalizeClassification(safeToInteract),
    ammoCurrent: finalizeNumeric(ammoCurrent),
    ammoReserve: finalizeNumeric(ammoReserve),
    economy: finalizeNumeric(economy),
    health: finalizeNumeric(health),
    objectiveArrow: {
      count: arrowErrors.length,
      meanAbsoluteAngularError: mean(arrowErrors),
      within15Degrees:
        arrowErrors.length > 0
          ? round4(arrowErrors.filter(error => error <= 15).length / arrowErrors.length)
          : undefined,
    },
    detections: {
      iouThreshold: 0.5,
      overall: finalizeDetection(overallDetections),
      categories: Object.fromEntries(
        Object.entries(detectionCategories).map(([category, metric]) => [
          category,
          finalizeDetection(metric),
        ]),
      ),
    },
    warnings,
  }
  if (input.baselineReportPath) {
    const baselinePath = resolveFromCwd(input.cwd, input.baselineReportPath)
    const baseline = JSON.parse(
      await readFile(baselinePath, 'utf8'),
    ) as GameBenchmarkEvaluation
    evaluation.baseline = compareWithBaseline(evaluation, baseline, baselinePath)
  }
  if (!input.reportPath) return { evaluation }
  const reportPath = resolveFromCwd(input.cwd, input.reportPath)
  await writeJsonAtomic(reportPath, evaluation)
  return { evaluation, reportPath }
}

type ClassificationAccumulator = { count: number; correct: number }
type NumericAccumulator = {
  count: number
  predicted: number
  missing: number
  absoluteError: number
  exact: number
}

function createClassificationAccumulator(): ClassificationAccumulator {
  return { count: 0, correct: 0 }
}

function createNumericAccumulator(): NumericAccumulator {
  return { count: 0, predicted: 0, missing: 0, absoluteError: 0, exact: 0 }
}

function accumulateClassification(
  accumulator: ClassificationAccumulator,
  truth: unknown,
  prediction: unknown,
): void {
  if (truth === undefined) return
  accumulator.count += 1
  if (truth === prediction) accumulator.correct += 1
}

function accumulateNumeric(
  accumulator: NumericAccumulator,
  truth: number | undefined,
  prediction: number | undefined,
): void {
  if (truth === undefined) return
  accumulator.count += 1
  if (prediction === undefined) {
    accumulator.missing += 1
    return
  }
  accumulator.predicted += 1
  accumulator.absoluteError += Math.abs(truth - prediction)
  if (truth === prediction) accumulator.exact += 1
}

function finalizeClassification(
  accumulator: ClassificationAccumulator,
): ClassificationMetric {
  return {
    ...accumulator,
    accuracy:
      accumulator.count > 0
        ? round4(accumulator.correct / accumulator.count)
        : undefined,
  }
}

function finalizeNumeric(accumulator: NumericAccumulator): NumericMetric {
  return {
    count: accumulator.count,
    predicted: accumulator.predicted,
    missing: accumulator.missing,
    meanAbsoluteError:
      accumulator.predicted > 0
        ? round4(accumulator.absoluteError / accumulator.predicted)
        : undefined,
    exactAccuracy:
      accumulator.count > 0
        ? round4(accumulator.exact / accumulator.count)
        : undefined,
  }
}

function emptyDetectionMetric(): DetectionMetric {
  return {
    groundTruth: 0,
    predicted: 0,
    truePositive: 0,
    falsePositive: 0,
    falseNegative: 0,
  }
}

function accumulateDetections(
  truth: GameObjectBox[],
  predictions: GameObjectBox[],
  categories: Record<string, DetectionMetric>,
): void {
  for (const category of GAME_OBJECT_CATEGORIES) {
    const categoryTruth = truth.filter(box => box.category === category)
    const categoryPredictions = predictions.filter(box => box.category === category)
    const candidates: Array<{ truthIndex: number; predictionIndex: number; iou: number }> = []
    for (let truthIndex = 0; truthIndex < categoryTruth.length; truthIndex += 1) {
      for (
        let predictionIndex = 0;
        predictionIndex < categoryPredictions.length;
        predictionIndex += 1
      ) {
        candidates.push({
          truthIndex,
          predictionIndex,
          iou: intersectionOverUnion(
            categoryTruth[truthIndex]!.rect,
            categoryPredictions[predictionIndex]!.rect,
          ),
        })
      }
    }
    candidates.sort((left, right) => right.iou - left.iou)
    const matchedTruth = new Set<number>()
    const matchedPredictions = new Set<number>()
    for (const candidate of candidates) {
      if (candidate.iou < 0.5) break
      if (
        matchedTruth.has(candidate.truthIndex) ||
        matchedPredictions.has(candidate.predictionIndex)
      ) {
        continue
      }
      matchedTruth.add(candidate.truthIndex)
      matchedPredictions.add(candidate.predictionIndex)
    }
    const metric = categories[category]!
    metric.groundTruth += categoryTruth.length
    metric.predicted += categoryPredictions.length
    metric.truePositive += matchedTruth.size
    metric.falseNegative += categoryTruth.length - matchedTruth.size
    metric.falsePositive += categoryPredictions.length - matchedPredictions.size
  }
}

function intersectionOverUnion(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
): number {
  const intersectionWidth = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) -
      Math.max(left.x, right.x),
  )
  const intersectionHeight = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) -
      Math.max(left.y, right.y),
  )
  const intersection = intersectionWidth * intersectionHeight
  const union =
    left.width * left.height + right.width * right.height - intersection
  return union > 0 ? intersection / union : 0
}

function mergeDetectionMetric(
  left: DetectionMetric,
  right: DetectionMetric,
): DetectionMetric {
  return {
    groundTruth: left.groundTruth + right.groundTruth,
    predicted: left.predicted + right.predicted,
    truePositive: left.truePositive + right.truePositive,
    falsePositive: left.falsePositive + right.falsePositive,
    falseNegative: left.falseNegative + right.falseNegative,
  }
}

function finalizeDetection(metric: DetectionMetric): DetectionMetric {
  const precisionDenominator = metric.truePositive + metric.falsePositive
  const recallDenominator = metric.truePositive + metric.falseNegative
  const precision =
    precisionDenominator > 0
      ? metric.truePositive / precisionDenominator
      : undefined
  const recall =
    recallDenominator > 0 ? metric.truePositive / recallDenominator : undefined
  return {
    ...metric,
    precision: precision === undefined ? undefined : round4(precision),
    recall: recall === undefined ? undefined : round4(recall),
    f1:
      precision !== undefined && recall !== undefined && precision + recall > 0
        ? round4((2 * precision * recall) / (precision + recall))
        : undefined,
  }
}

function angularError(left: number, right: number): number {
  const delta = Math.abs(left - right) % 360
  return Math.min(delta, 360 - delta)
}

function mean(values: number[]): number | undefined {
  return values.length > 0
    ? round4(values.reduce((total, value) => total + value, 0) / values.length)
    : undefined
}

function compareWithBaseline(
  current: GameBenchmarkEvaluation,
  baseline: GameBenchmarkEvaluation,
  path: string,
): NonNullable<GameBenchmarkEvaluation['baseline']> {
  if (baseline.datasetId !== current.datasetId) {
    throw new Error('Baseline benchmark was produced from a different dataset.')
  }
  const pairs: Array<[string, number | undefined, number | undefined, 'higher' | 'lower']> = [
    ['coverage', current.coverage, baseline.coverage, 'higher'],
    ['phase.accuracy', current.phase.accuracy, baseline.phase.accuracy, 'higher'],
    [
      'detections.overall.f1',
      current.detections.overall.f1,
      baseline.detections.overall.f1,
      'higher',
    ],
    [
      'objectiveArrow.meanAbsoluteAngularError',
      current.objectiveArrow.meanAbsoluteAngularError,
      baseline.objectiveArrow.meanAbsoluteAngularError,
      'lower',
    ],
  ]
  const deltas: Record<string, number> = {}
  const regressions: string[] = []
  for (const [name, currentValue, baselineValue, direction] of pairs) {
    if (currentValue === undefined || baselineValue === undefined) continue
    const delta = round4(currentValue - baselineValue)
    deltas[name] = delta
    if (
      (direction === 'higher' && delta < 0) ||
      (direction === 'lower' && delta > 0)
    ) {
      regressions.push(name)
    }
  }
  return { benchmarkId: baseline.benchmarkId, path, deltas, regressions }
}

async function verifySampleImage(
  datasetPath: string,
  sample: GameDatasetSample,
): Promise<boolean> {
  const imagePath = resolveWithin(datasetPath, sample.imagePath)
  try {
    return sha256(await readFile(imagePath)) === sample.imageSha256
  } catch {
    return false
  }
}

function parseJsonl<T>(
  content: string,
  schema: z.ZodType<T>,
  label: string,
): T[] {
  return content
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return schema.parse(JSON.parse(line))
      } catch (error) {
        throw new Error(
          `Invalid ${label} JSONL at line ${index + 1}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }
    })
}

function resolveWithin(rootInput: string, candidate: string): string {
  const root = resolve(rootInput)
  const resolved = resolve(root, candidate)
  const relation = relative(root, resolved)
  if (relation.startsWith('..') || isAbsolute(relation)) {
    throw new Error(`Dataset image path escapes its root: ${candidate}`)
  }
  return resolved
}

function resolveFromCwd(cwd: string, path: string): string {
  return isAbsolute(path) ? resolve(path) : resolve(cwd, path)
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporaryPath, path)
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function round4(value: number): number {
  return Number(value.toFixed(4))
}
