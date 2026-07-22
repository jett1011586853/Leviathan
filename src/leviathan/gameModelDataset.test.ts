import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { evaluateGameDatasetBenchmark } from '../game/benchmark.js'
import {
  loadGameCalibration,
  saveGameCalibration,
} from '../game/calibration.js'
import {
  buildGameDataset,
  getGameDatasetSample,
  loadGameDataset,
  saveGameAnnotation,
} from '../game/dataset.js'
import { ensureGameProfile } from '../game/profile.js'

describe('GameModel calibration and dataset pipeline', () => {
  test('versions normalized ROI calibration against a real reference image', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'leviathan-game-calibration-'))
    const { profile } = await ensureGameProfile(cwd)
    const referenceImage = await makeImage(320, 180, { r: 20, g: 40, b: 60 })
    const first = await saveGameCalibration({
      cwd,
      profileId: profile.id,
      referenceImage,
      windowViewport: { width: 1920, height: 1080 },
      regions: [
        {
          id: 'combat_view',
          kind: 'combat_view',
          rect: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
          enabled: true,
        },
        {
          id: 'ammo',
          kind: 'hud_ammo',
          rect: { x: 0.82, y: 0.82, width: 0.16, height: 0.12 },
          enabled: true,
        },
      ],
    })
    const second = await saveGameCalibration({
      cwd,
      profileId: profile.id,
      referenceImage,
      windowViewport: { width: 1920, height: 1080 },
      regions: first.calibration.regions,
    })
    expect(second.calibration.calibrationId).toBe(
      first.calibration.calibrationId,
    )
    expect(second.calibration.revision).toBe(2)
    expect((await loadGameCalibration({ cwd, profileId: profile.id })).calibration)
      .toMatchObject({
        calibrationId: first.calibration.calibrationId,
        revision: 2,
        windowViewport: { width: 1920, height: 1080 },
      })
  })

  test('builds an integrity-checked dataset and evaluates reviewed labels', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'leviathan-game-dataset-'))
    const { profile } = await ensureGameProfile(cwd)
    const referenceImage = await makeImage(320, 180, { r: 12, g: 24, b: 48 })
    const calibration = await saveGameCalibration({
      cwd,
      profileId: profile.id,
      referenceImage,
      windowViewport: { width: 1280, height: 720 },
      regions: [
        {
          id: 'targets',
          kind: 'target_search_area',
          rect: { x: 0.1, y: 0.08, width: 0.8, height: 0.8 },
          enabled: true,
        },
      ],
    })
    const sessionId = 'game_dataset_fixture'
    const sessionPath = join(cwd, '.leviathan', 'gamemodel', 'sessions', sessionId)
    const framesPath = join(sessionPath, 'frames')
    await mkdir(framesPath, { recursive: true })
    await writeFile(
      join(sessionPath, 'session.json'),
      `${JSON.stringify({ sessionId, profileId: profile.id })}\n`,
      'utf8',
    )
    const entries: unknown[] = []
    for (let index = 1; index <= 5; index += 1) {
      const png = await makeImage(160, 90, {
        r: index * 20,
        g: 30,
        b: 80,
      })
      const extension = index === 2 ? 'jpg' : 'png'
      const image = index === 2 ? await sharp(png).jpeg({ quality: 85 }).toBuffer() : png
      const imagePath = join(
        framesPath,
        `${String(index).padStart(8, '0')}.${extension}`,
      )
      await writeFile(imagePath, image)
      entries.push({
        schemaVersion: 1,
        sessionId,
        sequence: index,
        capturedAt: 1_000 + index * 500,
        frameId: index,
        frameSha256: digest(`raw-${index}`),
        imagePath: `frames/${String(index).padStart(8, '0')}.${extension}`,
        imageSha256: digest(image),
        viewport: { width: 1280, height: 720 },
        motionScore: index === 1 ? 0.01 : 0.2,
        frameMetrics: {
          meanLuma: 0.3,
          lumaStdDev: 0.1,
          blackFrameProbability: index === 5 ? 1 : 0,
          measuredFps: 60,
          processingMs: 4,
        },
      })
    }
    entries.push({
      ...(entries[2] as Record<string, unknown>),
      sequence: 6,
      capturedAt: 4_000,
    })
    await writeFile(
      join(sessionPath, 'frames.index.jsonl'),
      entries.map(entry => JSON.stringify(entry)).join('\n') + '\n',
      'utf8',
    )

    const built = await buildGameDataset({
      cwd,
      sessionPath,
      profileId: profile.id,
      calibrationPath: calibration.path,
      minimumMotionScore: 0.05,
      maxSamples: 10,
    })
    expect(built.manifest.sampleCount).toBe(3)
    expect(
      (await loadGameDataset(built.datasetPath)).samples.some(sample =>
        sample.imagePath.endsWith('.jpg'),
      ),
    ).toBe(true)
    expect(built.manifest.calibrationPath).toBe('calibration/manifest.json')
    expect(
      JSON.parse(
        await readFile(
          join(built.datasetPath, 'calibration', 'manifest.json'),
          'utf8',
        ),
      ).calibrationId,
    ).toBe(calibration.calibration.calibrationId)
    expect(built.manifest.skippedCounts).toEqual({
      duplicate: 1,
      lowMotion: 1,
      blackFrame: 1,
    })
    expect(
      Object.values(built.manifest.splitCounts).reduce(
        (total, count) => total + count,
        0,
      ),
    ).toBe(3)

    const next = await getGameDatasetSample({ datasetPath: built.datasetPath })
    expect(next.annotation.status).toBe('unlabeled')
    expect(digest(next.image)).toBe(next.sample.imageSha256)
    const annotated = await saveGameAnnotation({
      datasetPath: built.datasetPath,
      sampleId: next.sample.sampleId,
      status: 'reviewed',
      source: 'manual',
      labels: {
        phase: 'combat',
        ammo: { current: 30, reserve: 120 },
        objectiveArrow: { angleDeg: 20 },
        boxes: [
          {
            category: 'enemy',
            rect: { x: 0.4, y: 0.2, width: 0.2, height: 0.5 },
            occluded: false,
            truncated: false,
          },
        ],
      },
    })
    expect(annotated.annotation.revision).toBe(1)
    expect(annotated.manifest.annotationStatusCounts.reviewed).toBe(1)
    expect(
      await readFile(join(built.datasetPath, 'annotation-audit.jsonl'), 'utf8'),
    ).toContain(next.sample.sampleId)

    const predictionsPath = join(cwd, 'predictions.jsonl')
    await writeFile(
      predictionsPath,
      `${JSON.stringify({
        schemaVersion: 1,
        sampleId: next.sample.sampleId,
        detectorId: 'fixture-detector-v1',
        labels: {
          phase: 'combat',
          ammo: { current: 30, reserve: 120 },
          objectiveArrow: { angleDeg: 22 },
          boxes: [
            {
              category: 'enemy',
              rect: { x: 0.4, y: 0.2, width: 0.2, height: 0.5 },
              occluded: false,
              truncated: false,
            },
          ],
        },
      })}\n`,
      'utf8',
    )
    const benchmark = await evaluateGameDatasetBenchmark({
      cwd,
      datasetPath: built.datasetPath,
      predictionsPath,
      reportPath: join(cwd, 'benchmark.json'),
    })
    expect(benchmark.evaluation.coverage).toBe(1)
    expect(benchmark.evaluation.phase.accuracy).toBe(1)
    expect(benchmark.evaluation.ammoCurrent.meanAbsoluteError).toBe(0)
    expect(benchmark.evaluation.objectiveArrow.meanAbsoluteAngularError).toBe(2)
    expect(benchmark.evaluation.detections.overall.f1).toBe(1)
    expect(benchmark.evaluation.sampleCounts.imageIntegrityFailures).toBe(0)
    expect((await loadGameDataset(built.datasetPath)).manifest.annotationsSha256)
      .toBe(annotated.manifest.annotationsSha256)
  })

  test('rejects ROI regions that escape normalized image bounds', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'leviathan-game-invalid-roi-'))
    const { profile } = await ensureGameProfile(cwd)
    await expect(
      saveGameCalibration({
        cwd,
        profileId: profile.id,
        referenceImage: await makeImage(32, 32, { r: 0, g: 0, b: 0 }),
        windowViewport: { width: 32, height: 32 },
        regions: [
          {
            id: 'bad',
            kind: 'combat_view',
            rect: { x: 0.8, y: 0.1, width: 0.3, height: 0.5 },
            enabled: true,
          },
        ],
      }),
    ).rejects.toThrow()
  })
})

async function makeImage(
  width: number,
  height: number,
  background: { r: number; g: number; b: number },
): Promise<Buffer> {
  return await sharp({
    create: { width, height, channels: 4, background: { ...background, alpha: 1 } },
  })
    .png()
    .toBuffer()
}

function digest(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}
