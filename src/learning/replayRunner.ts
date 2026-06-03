import {
  compareReplayArtifacts,
  type ReplayCompareResult,
} from './replayCompare.js'
import { deriveReplayPlan, type ReplayPlan } from './replayPlan.js'
import type { LeviathanRolloutBundle } from './rolloutSchema.js'

export type ReplayExecutionRunner = (
  plan: ReplayPlan,
) => Promise<LeviathanRolloutBundle>

export type ReplayExecutionResult =
  | {
      status: 'blocked'
      blockers: string[]
      plan: ReplayPlan
    }
  | {
      status: 'completed'
      blockers: []
      plan: ReplayPlan
      replay: LeviathanRolloutBundle
      compare: ReplayCompareResult
    }

export async function executeReplayRun(
  golden: LeviathanRolloutBundle,
  runner: ReplayExecutionRunner,
): Promise<ReplayExecutionResult> {
  const plan = deriveReplayPlan(golden)
  if (!plan.ready) {
    return {
      status: 'blocked',
      blockers: plan.blockers,
      plan,
    }
  }

  const replay = await runner(plan)
  replay.run.source = 'replay'

  return {
    status: 'completed',
    blockers: [],
    plan,
    replay,
    compare: compareReplayArtifacts(golden, replay),
  }
}
