import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import {
  decideGameIntent,
} from './tacticalPolicy.js'
import type {
  GameObservation,
  GameProfile,
  GameReplayEvaluation,
} from './types.js'
import {
  applyGameObservation,
  createInitialGameWorldState,
} from './worldState.js'

export async function evaluateGameReplay(input: {
  replayPath: string
  profile: GameProfile
  reportPath?: string
}): Promise<{ evaluation: GameReplayEvaluation; reportPath?: string }> {
  const replayPath = resolve(input.replayPath)
  const observations = parseObservationJsonl(await readFile(replayPath, 'utf8'))
  let world = createInitialGameWorldState(observations[0]?.timestamp ?? Date.now())
  const phaseCounts: Record<string, number> = {}
  const intentCounts: Record<string, number> = {}
  let staleGapCount = 0
  let trustedSampleCount = 0
  let legacyUnverifiedSampleCount = 0
  let invalidProvenanceSampleCount = 0
  const adapterCounts: Record<string, number> = {}
  let targetObservationCount = 0
  let selectedTargetCount = 0
  let aimErrorTotal = 0
  let aimErrorCount = 0
  let previousTimestamp: number | undefined

  for (const observation of observations) {
    const trust = classifyObservationTrust(observation)
    if (trust === 'trusted') {
      trustedSampleCount += 1
      const adapterId = observation.provenance!.adapterId
      adapterCounts[adapterId] = (adapterCounts[adapterId] ?? 0) + 1
    } else if (trust === 'invalid') {
      invalidProvenanceSampleCount += 1
    } else {
      legacyUnverifiedSampleCount += 1
    }
    const timestamp = observation.timestamp ?? Date.now()
    if (
      previousTimestamp !== undefined &&
      timestamp - previousTimestamp > input.profile.policy.observationTimeoutMs
    ) {
      staleGapCount += 1
    }
    previousTimestamp = timestamp
    world = applyGameObservation(world, observation, input.profile)
    const gameIntent = decideGameIntent(world, input.profile, timestamp)
    phaseCounts[world.phase] = (phaseCounts[world.phase] ?? 0) + 1
    intentCounts[gameIntent.kind] = (intentCounts[gameIntent.kind] ?? 0) + 1
    targetObservationCount += observation.targets?.length ?? 0
    if (world.selectedTargetId) selectedTargetCount += 1
    const selectedTarget = world.targets.find(
      target => target.id === world.selectedTargetId,
    )
    if (selectedTarget) {
      aimErrorTotal += Math.hypot(
        selectedTarget.predictedX - world.viewport.width / 2,
        selectedTarget.predictedY - world.viewport.height / 2,
      )
      aimErrorCount += 1
    }
  }

  const start = observations[0]?.timestamp ?? 0
  const end = observations.at(-1)?.timestamp ?? start
  const evaluation: GameReplayEvaluation = {
    replayPath,
    profileId: input.profile.id,
    sampleCount: observations.length,
    trustedSampleCount,
    legacyUnverifiedSampleCount,
    invalidProvenanceSampleCount,
    adapterCounts,
    durationMs: Math.max(0, end - start),
    staleGapCount,
    phaseCounts,
    intentCounts,
    targetObservationCount,
    selectedTargetCount,
    averageAimErrorPixels:
      aimErrorCount > 0
        ? Number((aimErrorTotal / aimErrorCount).toFixed(2))
        : undefined,
    generatedAt: new Date().toISOString(),
  }

  if (input.reportPath) {
    const reportPath = resolve(input.reportPath)
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, `${JSON.stringify(evaluation, null, 2)}\n`, 'utf8')
    return { evaluation, reportPath }
  }
  return { evaluation }
}

function classifyObservationTrust(
  observation: GameObservation,
): 'trusted' | 'legacy' | 'invalid' {
  const provenance = observation.provenance
  if (!provenance) return 'legacy'
  if (
    provenance.schemaVersion !== 1 ||
    provenance.trust !== 'sidecar_adapter' ||
    observation.timestamp !== provenance.capturedAt
  ) {
    return 'invalid'
  }
  const {
    timestamp: _timestamp,
    provenance: _provenance,
    metadata: _metadata,
    ...payload
  } = observation
  const digest = createHash('sha256')
    .update(
      JSON.stringify({
        sessionId: provenance.sessionId,
        adapterInstanceId: provenance.adapterInstanceId,
        sequence: provenance.sequence,
        capturedAt: provenance.capturedAt,
        observation: payload,
      }),
    )
    .digest('hex')
  return digest === provenance.observationSha256 ? 'trusted' : 'invalid'
}

function parseObservationJsonl(content: string): GameObservation[] {
  return content
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        const observation = JSON.parse(line) as GameObservation
        if (
          observation.timestamp !== undefined &&
          !Number.isFinite(observation.timestamp)
        ) {
          throw new Error('timestamp must be finite')
        }
        return observation
      } catch (error) {
        throw new Error(
          `Invalid GameModel replay JSONL at line ${index + 1}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }
    })
}
