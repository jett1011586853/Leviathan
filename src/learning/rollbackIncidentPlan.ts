export type RollbackIncidentCoverage =
  | 'secret_leak'
  | 'benchmark_leak'
  | 'reward_hacking'
  | 'data_corruption'
  | 'regression_spike'

export type RollbackIncidentPlan = {
  permanent_checkpoint_tag: string
  rollback_commands: string[]
  feature_flags: string[]
  incident_owner: string
  incident_channels: string[]
  severity_routes: {
    p0: string
    p1: string
    p2: string
  }
  covers: Record<RollbackIncidentCoverage, boolean>
}

export type RollbackIncidentPlanValidation = {
  valid: boolean
  reasons: string[]
}

const REQUIRED_COVERAGE: RollbackIncidentCoverage[] = [
  'secret_leak',
  'benchmark_leak',
  'reward_hacking',
  'data_corruption',
  'regression_spike',
]

function hasText(value: string): boolean {
  return value.trim().length > 0
}

function hasPermanentCheckpointTag(tag: string): boolean {
  return (
    hasText(tag) &&
    tag.startsWith('checkpoint/') &&
    tag.includes('pre-hl-polar-training')
  )
}

function hasHardResetCheckpoint(commands: string[]): boolean {
  return commands.some(command =>
    /git\s+reset\s+--hard\s+checkpoint\/pre-hl-polar-training/.test(command),
  )
}

export function validateRollbackIncidentPlan(
  plan: RollbackIncidentPlan,
): RollbackIncidentPlanValidation {
  const reasons: string[] = []

  if (!hasPermanentCheckpointTag(plan.permanent_checkpoint_tag)) {
    reasons.push('permanent_checkpoint_tag')
  }
  if (!hasHardResetCheckpoint(plan.rollback_commands)) {
    reasons.push('rollback_commands.hard_reset_checkpoint')
  }
  if (plan.feature_flags.length === 0 || !plan.feature_flags.every(hasText)) {
    reasons.push('feature_flags')
  }
  if (!hasText(plan.incident_owner)) {
    reasons.push('incident_owner')
  }
  if (
    plan.incident_channels.length === 0 ||
    !plan.incident_channels.every(hasText)
  ) {
    reasons.push('incident_channels')
  }
  if (!hasText(plan.severity_routes.p0)) {
    reasons.push('severity_routes.p0')
  }
  if (!hasText(plan.severity_routes.p1)) {
    reasons.push('severity_routes.p1')
  }
  if (!hasText(plan.severity_routes.p2)) {
    reasons.push('severity_routes.p2')
  }

  for (const coverage of REQUIRED_COVERAGE) {
    if (plan.covers[coverage] !== true) {
      reasons.push(`covers.${coverage}`)
    }
  }

  return {
    valid: reasons.length === 0,
    reasons,
  }
}
