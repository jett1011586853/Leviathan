import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import {
  resolveCalibrationReferenceImage,
  type GameCalibrationManifest,
  type GameNormalizedRect,
  type GameRoiRegion,
} from './calibration.js'
import type {
  GameObservation,
  GamePerceptionCapability,
  GameThreatObservation,
} from './types.js'

const ANALYSIS_WIDTH = 960
const PHASE_CONFIDENCE_THRESHOLD = 0.66
const MAX_MINIMAP_THREATS = 24

const COMBAT_FEATURES = [
  { kind: 'minimap', feature: 'bright' as const, weight: 0.4 },
  { kind: 'hud_health', feature: 'cyan' as const, weight: 0.3 },
  { kind: 'hud_ammo', feature: 'bright' as const, weight: 0.3 },
] as const

type DecodedFrame = {
  data: Buffer
  width: number
  height: number
  channels: number
}

type ColorFeature = 'bright' | 'cyan'

type CombatTemplate = {
  region: GameRoiRegion
  feature: ColorFeature
  weight: number
  edgeGrid: number[]
  colorGrid: number[]
}

export type NzmFuturePerceptionObservation = Pick<
  GameObservation,
  'phase' | 'threats'
>

export type NzmFuturePerceptionResult = {
  observation: NzmFuturePerceptionObservation
  phaseConfidence: number
  objectiveCandidate?: { angleDeg: number; confidence: number }
  threatCount: number
  inferenceMs: number
}

export class NzmFutureObservePerceptionDetector {
  readonly id = 'com.leviathan.detector.nzm-future-observe.v1'
  readonly capabilities: GamePerceptionCapability[] = [
    'game.phase',
    'vision.threats',
  ]

  private constructor(
    private readonly calibration: GameCalibrationManifest,
    private readonly templates: CombatTemplate[],
  ) {}

  static async create(input: {
    calibrationPath: string
    calibration: GameCalibrationManifest
  }): Promise<NzmFutureObservePerceptionDetector> {
    const referencePath = resolveCalibrationReferenceImage(
      input.calibrationPath,
      input.calibration,
    )
    const referenceImage = await readFile(referencePath)
    if (sha256(referenceImage) !== input.calibration.referenceImage.sha256) {
      throw new Error('NZM Future calibration reference image digest mismatch.')
    }
    const reference = await decodeFrame(referenceImage)
    const templates = COMBAT_FEATURES.flatMap(config => {
      const region = findEnabledRegion(input.calibration, config.kind)
      if (!region) return []
      return [
        {
          region,
          feature: config.feature,
          weight: config.weight,
          edgeGrid: buildEdgeGrid(reference, region.rect),
          colorGrid: buildColorGrid(reference, region.rect, config.feature),
        },
      ]
    })
    if (templates.length < 2) {
      throw new Error(
        'NZM Future perception requires at least two enabled combat HUD ROIs.',
      )
    }
    return new NzmFutureObservePerceptionDetector(
      input.calibration,
      templates,
    )
  }

  async analyze(encodedFrame: Buffer): Promise<NzmFuturePerceptionResult> {
    const startedAt = performance.now()
    const frame = await decodeFrame(encodedFrame)
    assertCompatibleAspectRatio(frame, this.calibration)

    const phaseConfidence = detectCombatConfidence(frame, this.templates)
    const objective = detectObjectiveArrow(frame, this.calibration)
    const threats = detectMinimapThreats(frame, this.calibration)
    const isCombat = phaseConfidence >= PHASE_CONFIDENCE_THRESHOLD
    const observation: NzmFuturePerceptionObservation = {
      phase: isCombat ? 'combat' : 'unknown',
      threats: isCombat ? threats : [],
    }

    return {
      observation,
      phaseConfidence,
      objectiveCandidate: objective,
      threatCount: threats.length,
      inferenceMs: Number((performance.now() - startedAt).toFixed(2)),
    }
  }
}

async function decodeFrame(input: string | Buffer): Promise<DecodedFrame> {
  const result = await sharp(input)
    .resize({ width: ANALYSIS_WIDTH, withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  if (result.info.channels < 3) {
    throw new Error('NZM Future perception requires an RGB frame.')
  }
  return {
    data: result.data,
    width: result.info.width,
    height: result.info.height,
    channels: result.info.channels,
  }
}

function detectCombatConfidence(
  frame: DecodedFrame,
  templates: CombatTemplate[],
): number {
  let weightedScore = 0
  let totalWeight = 0
  let strongEvidenceCount = 0
  for (const template of templates) {
    const edgeSimilarity = cosineSimilarity(
      template.edgeGrid,
      buildEdgeGrid(frame, template.region.rect),
    )
    const colorSimilarity = cosineSimilarity(
      template.colorGrid,
      buildColorGrid(frame, template.region.rect, template.feature),
    )
    const score = clamp01(edgeSimilarity * 0.55 + colorSimilarity * 0.45)
    if (score >= 0.55) strongEvidenceCount += 1
    weightedScore += score * template.weight
    totalWeight += template.weight
  }
  if (strongEvidenceCount < 2 || totalWeight === 0) return 0
  return round4(weightedScore / totalWeight)
}

function detectObjectiveArrow(
  frame: DecodedFrame,
  calibration: GameCalibrationManifest,
): { angleDeg: number; confidence: number } | undefined {
  const region = findEnabledRegion(calibration, 'objective_arrow')
  if (!region) return undefined
  const candidates = [
    ...findColorComponents(frame, region.rect, isGoldPixel, 'gold'),
    ...findColorComponents(frame, region.rect, isCyanPixel, 'cyan'),
  ]
    .filter(component => {
      const relativeY = component.centerY / component.roiHeight
      return (
        component.pixelCount >= 3 &&
        component.pixelCount <= 500 &&
        component.width <= component.roiWidth * 0.12 &&
        component.height <= component.roiHeight * 0.55 &&
        relativeY <= 0.72
      )
    })
    .map(component => {
      const density =
        component.pixelCount / Math.max(1, component.width * component.height)
      const sizeScore = clamp01(component.pixelCount / 18)
      const densityScore = clamp01(density / 0.35)
      const verticalScore = 1 - component.centerY / component.roiHeight
      const colorWeight = component.label === 'gold' ? 1 : 0.82
      return {
        ...component,
        confidence: clamp01(
          (sizeScore * 0.4 + densityScore * 0.35 + verticalScore * 0.25) *
            colorWeight,
        ),
      }
    })
    .sort((left, right) => right.confidence - left.confidence)
  const selected = candidates[0]
  if (!selected) return undefined
  const screenX = region.rect.x + (selected.centerX / selected.roiWidth) * region.rect.width
  const angleDeg = clamp((screenX - 0.5) * 180, -90, 90)
  return {
    angleDeg: Number(angleDeg.toFixed(2)),
    confidence: round4(selected.confidence),
  }
}

function detectMinimapThreats(
  frame: DecodedFrame,
  calibration: GameCalibrationManifest,
): GameThreatObservation[] {
  const region = findEnabledRegion(calibration, 'minimap')
  if (!region) return []
  const minimapRect = insetRect(region.rect, {
    x: 0,
    y: 0,
    width: 0.78,
    height: 0.68,
  })
  const components = findColorComponents(
    frame,
    minimapRect,
    isThreatRedPixel,
    'red',
  )
  const centerX = 0.5
  const centerY = 0.5
  return components
    .filter(component => {
      const normalizedX = component.centerX / component.roiWidth
      const normalizedY = component.centerY / component.roiHeight
      const radius = Math.hypot(normalizedX - centerX, normalizedY - centerY)
      const density =
        component.pixelCount / Math.max(1, component.width * component.height)
      return (
        radius <= 0.54 &&
        component.pixelCount >= 2 &&
        component.pixelCount <= 120 &&
        component.width <= component.roiWidth * 0.12 &&
        component.height <= component.roiHeight * 0.12 &&
        density >= 0.15
      )
    })
    .map(component => {
      const normalizedX = component.centerX / component.roiWidth
      const normalizedY = component.centerY / component.roiHeight
      const deltaX = normalizedX - centerX
      const deltaY = normalizedY - centerY
      const density =
        component.pixelCount / Math.max(1, component.width * component.height)
      return {
        confidence: round4(
          clamp01(0.5 + Math.min(component.pixelCount, 16) / 40 + density * 0.2),
        ),
        direction: threatDirection(deltaX, deltaY),
        attackImminent: false,
      } satisfies GameThreatObservation
    })
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, MAX_MINIMAP_THREATS)
}

type ColorComponent = {
  label: string
  pixelCount: number
  centerX: number
  centerY: number
  width: number
  height: number
  roiWidth: number
  roiHeight: number
}

function findColorComponents(
  frame: DecodedFrame,
  rect: GameNormalizedRect,
  predicate: (red: number, green: number, blue: number) => boolean,
  label: string,
): ColorComponent[] {
  const pixels = pixelRect(frame, rect)
  const mask = new Uint8Array(pixels.width * pixels.height)
  for (let y = 0; y < pixels.height; y += 1) {
    for (let x = 0; x < pixels.width; x += 1) {
      const [red, green, blue] = rgbAt(frame, pixels.left + x, pixels.top + y)
      if (predicate(red, green, blue)) mask[y * pixels.width + x] = 1
    }
  }

  const components: ColorComponent[] = []
  const queueX = new Int32Array(mask.length)
  const queueY = new Int32Array(mask.length)
  for (let startY = 0; startY < pixels.height; startY += 1) {
    for (let startX = 0; startX < pixels.width; startX += 1) {
      const startIndex = startY * pixels.width + startX
      if (mask[startIndex] !== 1) continue
      let head = 0
      let tail = 0
      queueX[tail] = startX
      queueY[tail] = startY
      tail += 1
      mask[startIndex] = 2
      let count = 0
      let sumX = 0
      let sumY = 0
      let minX = startX
      let maxX = startX
      let minY = startY
      let maxY = startY
      while (head < tail) {
        const x = queueX[head]!
        const y = queueY[head]!
        head += 1
        count += 1
        sumX += x
        sumY += y
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            if (offsetX === 0 && offsetY === 0) continue
            const nextX = x + offsetX
            const nextY = y + offsetY
            if (
              nextX < 0 ||
              nextY < 0 ||
              nextX >= pixels.width ||
              nextY >= pixels.height
            ) {
              continue
            }
            const nextIndex = nextY * pixels.width + nextX
            if (mask[nextIndex] !== 1) continue
            mask[nextIndex] = 2
            queueX[tail] = nextX
            queueY[tail] = nextY
            tail += 1
          }
        }
      }
      components.push({
        label,
        pixelCount: count,
        centerX: sumX / count,
        centerY: sumY / count,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
        roiWidth: pixels.width,
        roiHeight: pixels.height,
      })
    }
  }
  return components
}

function buildEdgeGrid(
  frame: DecodedFrame,
  rect: GameNormalizedRect,
  columns = 12,
  rows = 8,
): number[] {
  const values = new Array<number>(columns * rows).fill(0)
  const counts = new Array<number>(columns * rows).fill(0)
  const pixels = pixelRect(frame, rect)
  for (let y = 0; y < pixels.height - 1; y += 2) {
    for (let x = 0; x < pixels.width - 1; x += 2) {
      const absoluteX = pixels.left + x
      const absoluteY = pixels.top + y
      const current = lumaAt(frame, absoluteX, absoluteY)
      const right = lumaAt(frame, absoluteX + 1, absoluteY)
      const down = lumaAt(frame, absoluteX, absoluteY + 1)
      const edge = (Math.abs(current - right) + Math.abs(current - down)) / 510
      const column = Math.min(columns - 1, Math.floor((x / pixels.width) * columns))
      const row = Math.min(rows - 1, Math.floor((y / pixels.height) * rows))
      const index = row * columns + column
      values[index] = values[index]! + edge
      counts[index] = counts[index]! + 1
    }
  }
  return values.map((value, index) => value / Math.max(1, counts[index]!))
}

function buildColorGrid(
  frame: DecodedFrame,
  rect: GameNormalizedRect,
  feature: ColorFeature,
  columns = 12,
  rows = 8,
): number[] {
  const values = new Array<number>(columns * rows).fill(0)
  const counts = new Array<number>(columns * rows).fill(0)
  const pixels = pixelRect(frame, rect)
  const predicate = feature === 'cyan' ? isCyanPixel : isBrightPixel
  for (let y = 0; y < pixels.height; y += 2) {
    for (let x = 0; x < pixels.width; x += 2) {
      const column = Math.min(columns - 1, Math.floor((x / pixels.width) * columns))
      const row = Math.min(rows - 1, Math.floor((y / pixels.height) * rows))
      const index = row * columns + column
      const [red, green, blue] = rgbAt(frame, pixels.left + x, pixels.top + y)
      if (predicate(red, green, blue)) values[index] = values[index]! + 1
      counts[index] = counts[index]! + 1
    }
  }
  return values.map((value, index) => value / Math.max(1, counts[index]!))
}

function findEnabledRegion(
  calibration: GameCalibrationManifest,
  kind: GameRoiRegion['kind'],
): GameRoiRegion | undefined {
  return calibration.regions.find(region => region.enabled && region.kind === kind)
}

function pixelRect(frame: DecodedFrame, rect: GameNormalizedRect): {
  left: number
  top: number
  width: number
  height: number
} {
  const left = clamp(Math.floor(rect.x * frame.width), 0, frame.width - 1)
  const top = clamp(Math.floor(rect.y * frame.height), 0, frame.height - 1)
  const right = clamp(
    Math.ceil((rect.x + rect.width) * frame.width),
    left + 1,
    frame.width,
  )
  const bottom = clamp(
    Math.ceil((rect.y + rect.height) * frame.height),
    top + 1,
    frame.height,
  )
  return { left, top, width: right - left, height: bottom - top }
}

function insetRect(
  parent: GameNormalizedRect,
  local: GameNormalizedRect,
): GameNormalizedRect {
  return {
    x: parent.x + local.x * parent.width,
    y: parent.y + local.y * parent.height,
    width: local.width * parent.width,
    height: local.height * parent.height,
  }
}

function rgbAt(
  frame: DecodedFrame,
  x: number,
  y: number,
): [number, number, number] {
  const offset = (y * frame.width + x) * frame.channels
  return [
    frame.data[offset]!,
    frame.data[offset + 1]!,
    frame.data[offset + 2]!,
  ]
}

function lumaAt(frame: DecodedFrame, x: number, y: number): number {
  const [red, green, blue] = rgbAt(frame, x, y)
  return red * 0.2126 + green * 0.7152 + blue * 0.0722
}

function isBrightPixel(red: number, green: number, blue: number): boolean {
  const maximum = Math.max(red, green, blue)
  const minimum = Math.min(red, green, blue)
  return maximum >= 165 && maximum - minimum <= 70
}

function isCyanPixel(red: number, green: number, blue: number): boolean {
  return green >= 90 && blue >= 110 && blue - red >= 24 && green - red >= 5
}

function isGoldPixel(red: number, green: number, blue: number): boolean {
  return red >= 145 && green >= 80 && red - green <= 115 && green - blue >= 28
}

function isThreatRedPixel(red: number, green: number, blue: number): boolean {
  return red >= 135 && red - green >= 48 && red - blue >= 30
}

function threatDirection(
  deltaX: number,
  deltaY: number,
): GameThreatObservation['direction'] {
  if (Math.hypot(deltaX, deltaY) < 0.06) return 'unknown'
  if (Math.abs(deltaX) > Math.abs(deltaY)) return deltaX < 0 ? 'left' : 'right'
  return deltaY < 0 ? 'front' : 'rear'
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) return 0
  let product = 0
  let leftMagnitude = 0
  let rightMagnitude = 0
  for (let index = 0; index < left.length; index += 1) {
    product += left[index]! * right[index]!
    leftMagnitude += left[index]! ** 2
    rightMagnitude += right[index]! ** 2
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return 0
  return product / Math.sqrt(leftMagnitude * rightMagnitude)
}

function assertCompatibleAspectRatio(
  frame: DecodedFrame,
  calibration: GameCalibrationManifest,
): void {
  const expected = calibration.windowViewport.width / calibration.windowViewport.height
  const actual = frame.width / frame.height
  if (Math.abs(expected - actual) / expected > 0.03) {
    throw new Error(
      `Frame aspect ratio ${actual.toFixed(3)} does not match calibration ${expected.toFixed(3)}.`,
    )
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function clamp01(value: number): number {
  return clamp(value, 0, 1)
}

function round4(value: number): number {
  return Number(value.toFixed(4))
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}
