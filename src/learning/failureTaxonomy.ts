import type { LeviathanRolloutBundle } from './rolloutSchema.js'

export type FailureTaxonomyCode =
  | 'model_interaction_failure'
  | 'tool_choice_failure'
  | 'execution_environment_failure'
  | 'code_modification_failure'
  | 'verification_failure'
  | 'memory_context_failure'
  | 'recovery_control_failure'
  | 'security_governance_failure'

export type FailureTaxonomyEntry = {
  code: FailureTaxonomyCode
  label: string
  signals: string[]
  target_assets: string[]
}

export type FailureSignalMap = Record<string, boolean | undefined>

export type FailureTaxonomyCoverage = {
  total: number
  classified: number
  coverage_ratio: number
  ready_at_80_percent: boolean
  uncovered_run_ids: string[]
}

export const FAILURE_TAXONOMY: FailureTaxonomyEntry[] = [
  {
    code: 'model_interaction_failure',
    label: 'Model interaction failure',
    signals: [
      'proxy_bypass',
      'provider_mismatch',
      'stream_truncated',
      'context_overflow',
    ],
    target_assets: ['routing', 'provider_adapter', 'context_policy'],
  },
  {
    code: 'tool_choice_failure',
    label: 'Tool choice failure',
    signals: ['wrong_tool', 'bad_args', 'schema_mismatch', 'missing_tool'],
    target_assets: ['tool_policy', 'prompt_policy'],
  },
  {
    code: 'execution_environment_failure',
    label: 'Execution environment failure',
    signals: ['permission_deny', 'sandbox', 'dependency', 'network', 'timeout'],
    target_assets: ['permission_policy', 'runtime_config', 'recovery_policy'],
  },
  {
    code: 'code_modification_failure',
    label: 'Code modification failure',
    signals: ['wrong_file', 'malformed_patch', 'partial_write', 'merge_conflict'],
    target_assets: ['controller_logic', 'edit_strategy', 'recovery'],
  },
  {
    code: 'verification_failure',
    label: 'Verification failure',
    signals: ['test_selection_wrong', 'flaky_tests', 'hidden_regression'],
    target_assets: ['regression_tests', 'evaluation_policy'],
  },
  {
    code: 'memory_context_failure',
    label: 'Memory and context failure',
    signals: ['stale_memory', 'memory_pollution', 'compression_loss'],
    target_assets: ['memory_policy', 'context_compression'],
  },
  {
    code: 'recovery_control_failure',
    label: 'Recovery and control failure',
    signals: ['no_retry', 'endless_loop', 'bad_rollback', 'stop_too_early'],
    target_assets: ['recovery_rules', 'controller_logic'],
  },
  {
    code: 'security_governance_failure',
    label: 'Security and governance failure',
    signals: ['secret_leak', 'benchmark_leak', 'unsafe_export'],
    target_assets: ['exporter', 'security_flags', 'benchmark_governance'],
  },
]

const KNOWN_PRIMARY_CODES = new Set(FAILURE_TAXONOMY.map(entry => entry.code))

export function classifyFailureSignals(
  signals: FailureSignalMap,
): FailureTaxonomyEntry | null {
  for (const entry of FAILURE_TAXONOMY) {
    if (entry.signals.some(signal => signals[signal])) {
      return entry
    }
  }
  return null
}

function primaryCode(code: string): string {
  return code.split('.')[0] ?? ''
}

function hasKnownTaxonomy(bundle: LeviathanRolloutBundle): boolean {
  return bundle.failure.taxonomy.some(code =>
    KNOWN_PRIMARY_CODES.has(primaryCode(code) as FailureTaxonomyCode),
  )
}

export function measureFailureTaxonomyCoverage(
  bundles: LeviathanRolloutBundle[],
): FailureTaxonomyCoverage {
  const uncovered_run_ids: string[] = []
  let classified = 0

  for (const bundle of bundles) {
    if (hasKnownTaxonomy(bundle)) {
      classified += 1
    } else {
      uncovered_run_ids.push(bundle.run.run_id)
    }
  }

  const total = bundles.length
  const coverage_ratio = total === 0 ? 0 : classified / total

  return {
    total,
    classified,
    coverage_ratio,
    ready_at_80_percent: total > 0 && coverage_ratio >= 0.8,
    uncovered_run_ids,
  }
}
