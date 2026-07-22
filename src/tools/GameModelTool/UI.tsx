import * as React from 'react'
import { MessageResponse } from '../../components/MessageResponse.js'
import { OutputLine } from '../../components/shell/OutputLine.js'
import { Text } from '../../ink.js'
import type { GameModelAction } from './constants.js'
import type { GameModelToolInput, GameModelToolOutput } from './GameModelTool.js'

export function getGameModelToolSummary(
  input: Partial<GameModelToolInput>,
): string | null {
  if (!input.action) return null
  if (input.action === 'run_menu_flow' || input.action === 'save_menu_flow') {
    return `${input.action} ${input.flow_name ?? ''}`.trim()
  }
  if (input.action === 'start_session') {
    return `${input.action} ${input.hwnd ?? 'observation-only'}`
  }
  if (input.action === 'evaluate_replay') {
    return `${input.action} ${input.replay_path ?? ''}`.trim()
  }
  if (input.action === 'build_dataset') {
    return `${input.action} ${input.session_path ?? ''}`.trim()
  }
  if (
    input.action === 'get_annotation_sample' ||
    input.action === 'save_annotation'
  ) {
    return `${input.action} ${input.sample_id ?? 'next'}`
  }
  if (input.action === 'evaluate_detector_benchmark') {
    return `${input.action} ${input.predictions_path ?? ''}`.trim()
  }
  return input.action
}

export function renderToolUseMessage(
  input: Partial<GameModelToolInput>,
): React.ReactNode {
  const summary = getGameModelToolSummary(input)
  return summary ? <Text>GameModel: {summary}</Text> : null
}

export function renderToolResultMessage(
  output: GameModelToolOutput,
  _progressMessages: unknown[],
  { verbose }: { verbose: boolean },
): React.ReactNode {
  if (output.screenshot) {
    return (
      <MessageResponse height={1}>
        <Text dimColor>
          GameModel verification screenshot captured ({output.screenshot.width}x
          {output.screenshot.height})
        </Text>
      </MessageResponse>
    )
  }
  return <OutputLine content={summarize(output)} verbose={verbose} />
}

function summarize(output: GameModelToolOutput): string {
  const rows = [output.message]
  if (output.mode) rows.push(`mode: ${output.mode}`)
  if (output.profile_path) rows.push(`profile: ${output.profile_path}`)
  if (output.summary) {
    rows.push(
      `session: ${output.summary.sessionId} (${output.summary.status})`,
      `intent: ${output.summary.currentIntent?.kind ?? 'none'}`,
      `observations: ${output.summary.observationCount}, decisions: ${output.summary.decisionCount}`,
      `trusted perception: ${output.summary.perception.trustedObservationCount}, rejected: ${output.summary.perception.rejectedObservationCount}`,
      `adapter: ${output.summary.perception.adapterId ?? output.summary.perception.status}`,
      `capture: ${output.summary.perception.captureBackend ?? 'none'} at ${output.summary.perception.measuredFps?.toFixed(1) ?? 'unknown'} FPS`,
      `native frames: ${output.summary.perception.nativeFrameCount ?? 0}, dropped: ${output.summary.perception.droppedFrameCount ?? 0}, black: ${output.summary.perception.blackFrameCount ?? 0}`,
      ...(output.summary.demonstration
        ? [
            `demo input: ${output.summary.demonstration.status} at ${output.summary.demonstration.sampleHz} Hz, focused: ${output.summary.demonstration.targetFocused ?? 'unknown'}`,
            `human actions: ${output.summary.demonstration.alignedActionCount} aligned / ${output.summary.demonstration.rawSampleCount} raw, focus losses: ${output.summary.demonstration.focusLossCount}`,
          ]
        : []),
      ...(output.summary.perception.detectorId
        ? [
            `detector: ${output.summary.perception.detectorId}`,
            `detector samples: ${output.summary.perception.detectorAnalyzedFrameCount ?? 0}, errors: ${output.summary.perception.detectorErrorCount ?? 0}, last inference: ${output.summary.perception.detectorLastInferenceMs?.toFixed(1) ?? 'unknown'} ms`,
            `detector evidence: combat ${output.summary.perception.detectorLastPhaseConfidence?.toFixed(3) ?? 'n/a'}, objective candidate ${output.summary.perception.detectorLastObjectiveCandidateConfidence?.toFixed(3) ?? 'n/a'} at ${output.summary.perception.detectorLastObjectiveCandidateAngleDeg?.toFixed(1) ?? 'n/a'} deg, threats ${output.summary.perception.detectorLastThreatCount ?? 0}`,
          ]
        : []),
      `artifacts: ${output.summary.sessionDir}`,
    )
  }
  if (output.evaluation) {
    rows.push(
      `samples: ${output.evaluation.sampleCount}`,
      `trusted: ${output.evaluation.trustedSampleCount}, legacy unverified: ${output.evaluation.legacyUnverifiedSampleCount}, invalid provenance: ${output.evaluation.invalidProvenanceSampleCount}`,
      `duration: ${output.evaluation.durationMs} ms`,
      `stale gaps: ${output.evaluation.staleGapCount}`,
    )
  }
  if (output.calibration) {
    rows.push(
      `calibration: ${output.calibration.calibrationId} revision ${output.calibration.revision}`,
      `regions: ${output.calibration.regions.length}`,
    )
  }
  if (output.dataset) {
    rows.push(
      `dataset: ${output.dataset.datasetId}`,
      `samples: ${output.dataset.sampleCount}`,
      `annotations: ${JSON.stringify(output.dataset.annotationStatusCounts)}`,
    )
  }
  if (output.benchmark) {
    rows.push(
      `benchmark: ${output.benchmark.benchmarkId}`,
      `coverage: ${(output.benchmark.coverage * 100).toFixed(1)}%`,
      `phase accuracy: ${output.benchmark.phase.accuracy ?? 'n/a'}`,
      `detection F1: ${output.benchmark.detections.overall.f1 ?? 'n/a'}`,
    )
  }
  return rows.join('\n')
}

export function actionLabel(action: GameModelAction): string {
  return action.replaceAll('_', ' ')
}
