import type { LeviathanRolloutBundle } from './rolloutSchema.js'

export type ReplayPlan = {
  ready: boolean
  blockers: string[]
  context: {
    repo: string
    base_commit: string
    harness_version: string
    heuristic_bundle_version: string
    policy_version: string
    network_policy: 'off' | 'restricted' | 'on'
  }
  compare_policy: {
    tool_trace: 'name_order_status'
    patch: 'normalized_diff'
    tests: 'command_identity_exit_code_and_output'
    failure_taxonomy: 'primary_class_exact'
    final_outcome: 'exact'
  }
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function deriveReplayPlan(bundle: LeviathanRolloutBundle): ReplayPlan {
  const blockers: string[] = []

  if (!hasText(bundle.task.repo)) blockers.push('task.repo')
  if (!hasText(bundle.task.base_commit)) blockers.push('task.base_commit')
  if (!hasText(bundle.run.harness_version)) {
    blockers.push('run.harness_version')
  }
  if (!hasText(bundle.run.heuristic_bundle_version)) {
    blockers.push('run.heuristic_bundle_version')
  }
  if (!hasText(bundle.run.policy_version)) blockers.push('run.policy_version')
  if (!hasText(bundle.runtime.network_policy)) {
    blockers.push('runtime.network_policy')
  }

  return {
    ready: blockers.length === 0,
    blockers,
    context: {
      repo: bundle.task.repo,
      base_commit: bundle.task.base_commit,
      harness_version: bundle.run.harness_version,
      heuristic_bundle_version: bundle.run.heuristic_bundle_version,
      policy_version: bundle.run.policy_version,
      network_policy: bundle.runtime.network_policy,
    },
    compare_policy: {
      tool_trace: 'name_order_status',
      patch: 'normalized_diff',
      tests: 'command_identity_exit_code_and_output',
      failure_taxonomy: 'primary_class_exact',
      final_outcome: 'exact',
    },
  }
}
