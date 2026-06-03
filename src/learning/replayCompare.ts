import type { LeviathanRolloutBundle, RolloutToolEvent } from './rolloutSchema.js'

export type ReplayCompareScores = {
  tool_trace: 0 | 1
  patch: 0 | 1
  tests: 0 | 1
  failure_taxonomy: 0 | 1
  final_outcome: 0 | 1
}

export type ReplayCompareResult = {
  passed: boolean
  mismatches: (keyof ReplayCompareScores)[]
  scores: ReplayCompareScores
}

function normalizeWhitespace(value: string): string {
  return value
    .split('\n')
    .map(line => line.trim().replace(/\s+/g, ' '))
    .filter(line => line.length > 0)
    .join('\n')
}

function normalizeDiff(diff: string): string {
  return normalizeWhitespace(diff)
}

function toolTraceSignature(events: RolloutToolEvent[]): string {
  return events
    .map(event =>
      [
        event.tool_name,
        event.success === null ? 'unknown' : String(event.success),
      ].join(':'),
    )
    .join('|')
}

function testsSignature(bundle: LeviathanRolloutBundle): string {
  return JSON.stringify({
    exit_codes: bundle.evaluation.exit_codes,
    test_outputs: bundle.evaluation.test_outputs,
  })
}

function primaryFailureTaxonomy(bundle: LeviathanRolloutBundle): string {
  const first = bundle.failure.taxonomy[0] ?? ''
  return first.split('.')[0]
}

export function compareReplayArtifacts(
  golden: LeviathanRolloutBundle,
  replay: LeviathanRolloutBundle,
): ReplayCompareResult {
  const scores: ReplayCompareScores = {
    tool_trace:
      toolTraceSignature(golden.tool_events) ===
      toolTraceSignature(replay.tool_events)
        ? 1
        : 0,
    patch:
      normalizeDiff(golden.code_changes.diff) ===
      normalizeDiff(replay.code_changes.diff)
        ? 1
        : 0,
    tests: testsSignature(golden) === testsSignature(replay) ? 1 : 0,
    failure_taxonomy:
      primaryFailureTaxonomy(golden) === primaryFailureTaxonomy(replay) ? 1 : 0,
    final_outcome:
      golden.evaluation.final_outcome === replay.evaluation.final_outcome
        ? 1
        : 0,
  }

  const mismatches = (Object.keys(scores) as (keyof ReplayCompareScores)[]).filter(
    key => scores[key] === 0,
  )

  return {
    passed: mismatches.length === 0,
    mismatches,
    scores,
  }
}
