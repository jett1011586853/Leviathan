export const ROLLOUT_SCHEMA_VERSION = 'leviathan.rollout.v1' as const

export const OPTIONAL_ROLLOUT_FIELDS = [
  'prompt_token_ids',
  'response_token_ids',
  'response_logprobs',
  'raw_usage',
  'streaming_chunks',
  'loss_mask',
  'provider_metadata',
] as const

export const POLAR_ONLY_ROLLOUT_FIELDS = [
  'completion_session_id',
  'trajectory_builder_strategy',
  'trace_rewards',
  'outcome_reward',
  'trainer_stream_metadata',
  'group_id',
  'rollout_step',
  'policy_rollout_step',
  'sampling_params',
] as const

export type RolloutSource = 'internal' | 'benchmark' | 'replay' | 'canary'
export type RolloutSplit = 'train' | 'dev' | 'test' | 'held_out' | 'shadow'
export type RolloutFinalOutcome =
  | 'unknown'
  | 'resolved'
  | 'unresolved'
  | 'regression'

export type CreateRolloutBundleInput = {
  runId: string
  sessionId: string
  taskId: string
  source: RolloutSource
  split: RolloutSplit
  timestamp: string
  harnessVersion: string
  heuristicBundleVersion: string
  policyVersion: string
  userInstruction: string
  repo: string
  baseCommit: string
  cwdAlias: string
}

export type RolloutMessage = {
  message_id: string
  role: string
  timestamp?: string
  content: unknown
  model?: string
  request_id?: string
}

export type RolloutToolEvent = {
  tool_use_id: string
  tool_name: string
  input_redacted: unknown
  success: boolean | null
  result_summary: string
}

export type LeviathanRolloutBundle = {
  schema_version: typeof ROLLOUT_SCHEMA_VERSION
  run: {
    run_id: string
    session_id: string
    task_id: string
    source: RolloutSource
    split: RolloutSplit
    timestamp: string
    harness_version: string
    heuristic_bundle_version: string
    policy_version: string
  }
  task: {
    user_instruction: string
    repo: string
    base_commit: string
    cwd_alias: string
  }
  runtime: {
    cwd_alias: string
    network_policy: 'off' | 'restricted' | 'on'
    container_image: string
    timeout_sec: number | null
    seed: number | null
    sampling_params: Record<string, unknown>
  }
  messages: RolloutMessage[]
  tool_events: RolloutToolEvent[]
  code_changes: {
    diff: string
    changed_files: string[]
  }
  evaluation: {
    test_commands: string[]
    test_outputs: string[]
    exit_codes: number[]
    final_outcome: RolloutFinalOutcome
    resolved_label: boolean | null
  }
  failure: {
    taxonomy: string[]
    root_cause_summary: string
  }
  security: {
    export_allowed: boolean
    contains_private_code: boolean
    redaction_profile: string
  }
}

export function createEmptyRolloutBundle(
  input: CreateRolloutBundleInput,
): LeviathanRolloutBundle {
  return {
    schema_version: ROLLOUT_SCHEMA_VERSION,
    run: {
      run_id: input.runId,
      session_id: input.sessionId,
      task_id: input.taskId,
      source: input.source,
      split: input.split,
      timestamp: input.timestamp,
      harness_version: input.harnessVersion,
      heuristic_bundle_version: input.heuristicBundleVersion,
      policy_version: input.policyVersion,
    },
    task: {
      user_instruction: input.userInstruction,
      repo: input.repo,
      base_commit: input.baseCommit,
      cwd_alias: input.cwdAlias,
    },
    runtime: {
      cwd_alias: input.cwdAlias,
      network_policy: 'restricted',
      container_image: 'unknown',
      timeout_sec: null,
      seed: null,
      sampling_params: {},
    },
    messages: [],
    tool_events: [],
    code_changes: {
      diff: '',
      changed_files: [],
    },
    evaluation: {
      test_commands: [],
      test_outputs: [],
      exit_codes: [],
      final_outcome: 'unknown',
      resolved_label: null,
    },
    failure: {
      taxonomy: [],
      root_cause_summary: '',
    },
    security: {
      export_allowed: false,
      contains_private_code: true,
      redaction_profile: 'leviathan.redaction.v1',
    },
  }
}
