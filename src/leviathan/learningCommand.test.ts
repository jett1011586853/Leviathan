import { describe, expect, test } from 'bun:test'
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { getCommands } from '../commands.js'
import {
  call,
  parseLearningCommandArgs,
} from '../commands/learning/learning.js'
import {
  TRAINING_READINESS_CHECKS,
  type TrainingReadinessEvidence,
} from '../learning/trainingReadiness.js'
import { createEmptyRolloutBundle } from '../learning/rolloutSchema.js'
import type { PolarProxySpikeObservation } from '../learning/polarProxySpike.js'
import type { HeuristicTrainingResult } from '../learning/heuristicTrainer.js'
import type { PromotionEvidence } from '../learning/promotionGate.js'
import type { PolarHarnessTrainingResult } from '../learning/polarHarnessTrainer.js'
import type { PolarHarnessPromotionEvidence } from '../learning/polarHarnessPromotion.js'
import type { PromotionEvidenceSnapshot } from '../learning/promotionEvidenceFiles.js'
import type { LearningBundle } from '../learning/learningBundleFiles.js'

function allReadyEvidence(): TrainingReadinessEvidence {
  return Object.fromEntries(
    TRAINING_READINESS_CHECKS.map(check => [check.id, true]),
  ) as TrainingReadinessEvidence
}

function readyLaunchConfig(): unknown {
  return {
    provider_model_id: 'mimo-v2.5',
    policy_trainability: 'closed_api',
    readiness_evidence: allReadyEvidence(),
    baseline_matrix: {
      policy_trainability: 'closed_api',
      enabled_arms: ['baseline', 'hl_only', 'polar_only', 'hl_polar'],
    },
    rollout_bundle_count: 128,
    cwd_alias: '$WORKDIR',
    git_commit: 'abc123',
    rollback_checkpoint_tag: 'checkpoint/hl-polar-readiness-foundation-v1.0',
  }
}

function rolloutBundle(): unknown {
  const bundle = createEmptyRolloutBundle({
    runId: 'run_collect_1',
    sessionId: 'session_collect_1',
    taskId: 'task_collect_1',
    source: 'internal',
    split: 'shadow',
    timestamp: '2026-06-03T00:00:00.000Z',
    harnessVersion: 'git:abc123',
    heuristicBundleVersion: 'hb:initial',
    policyVersion: 'mimo-v2.5',
    userInstruction: 'collect evidence through slash command',
    repo: 'leviathan',
    baseCommit: 'abc123',
    cwdAlias: '$WORKDIR',
  })
  bundle.failure.taxonomy = ['tool_choice_failure.bad_args']
  return bundle
}

function resolvedHeldOutRolloutBundle(): unknown {
  const bundle = createEmptyRolloutBundle({
    runId: 'run_held_out_1',
    sessionId: 'session_held_out_1',
    taskId: 'task_held_out_1',
    source: 'internal',
    split: 'held_out',
    timestamp: '2026-06-03T00:00:00.000Z',
    harnessVersion: 'git:abc123',
    heuristicBundleVersion: 'hb:candidate/train_1',
    policyVersion: 'mimo-v2.5',
    userInstruction: 'evaluate held-out pipeline task',
    repo: 'leviathan',
    baseCommit: 'abc123',
    cwdAlias: '$WORKDIR',
  })
  bundle.failure.taxonomy = ['tool_choice_failure.bad_args']
  bundle.evaluation.final_outcome = 'resolved'
  bundle.evaluation.resolved_label = true
  bundle.evaluation.exit_codes = [0]
  return bundle
}

function polarObservation(
  case_id: PolarProxySpikeObservation['case_id'],
  overrides: Partial<PolarProxySpikeObservation> = {},
): PolarProxySpikeObservation {
  return {
    case_id,
    captured_requests_count: 1,
    leviathan_model_requests_count: 1,
    request_response_pairs_complete: true,
    run_session_binding_complete: true,
    final_outcome_recorded: true,
    streaming_complete: true,
    tool_use_complete: true,
    trajectory_completeness: true,
    replay_fidelity: true,
    reward_binding_success: true,
    causal_chain_model_tool_diff_complete: true,
    test_artifacts_complete: true,
    ...overrides,
  }
}

function heuristicTrainingResult(): HeuristicTrainingResult {
  return {
    schema_version: 'leviathan.heuristic_training.v1',
    status: 'candidate_only',
    training_run_id: 'train_1',
    provider_model_id: 'mimo-v2.5',
    provider_model_update: 'none',
    base_heuristic_bundle_version: 'hb:initial',
    candidate_heuristic_bundle_version: 'hb:candidate/train_1',
    stable_promotions_allowed: false,
    trained_failure_classes: ['tool_choice_failure'],
    candidates: [
      {
        id: 'candidate_tool_choice_failure_001',
        type: 'candidate tool policy',
        status: 'candidate',
        source_failure_taxonomy: ['tool_choice_failure.bad_args'],
        feature_flag: 'hl.candidate.tool_choice_failure_001',
        rollback_plan:
          'Disable feature flag hl.candidate.tool_choice_failure_001',
      },
    ],
    blocked_reasons: [],
  }
}

function promotionEvidence(): PromotionEvidence {
  return {
    replay_passed: true,
    held_out_passed: true,
    security_scan_passed: true,
    complexity_budget_passed: true,
    target_failure_slice_improved: true,
    p0_p1_regressions: 0,
    token_turn_cost_regression_pct: 0.04,
  }
}

function polarHarnessTrainingResult(): PolarHarnessTrainingResult {
  return {
    schema_version: 'leviathan.polar_harness_training.v1',
    status: 'candidate_only',
    training_run_id: 'train_1',
    provider_model_id: 'mimo-v2.5',
    provider_model_update: 'none',
    base_harness_version: 'git:abc123',
    candidate_harness_version: 'polar:candidate/train_1',
    stable_promotions_allowed: false,
    trained_failure_attributions: ['proxy_bypass'],
    updates: [
      {
        id: 'polar_candidate_proxy_bypass_001',
        status: 'candidate',
        failure_attribution: 'proxy_bypass',
        target_harness_asset: 'model_request_capture',
        source_cases: ['case_a_no_tool'],
        feature_flag: 'polar.candidate.proxy_bypass_001',
        rollback_plan:
          'Disable feature flag polar.candidate.proxy_bypass_001',
      },
    ],
    blocked_reasons: [],
  }
}

function polarPromotionEvidence(): PolarHarnessPromotionEvidence {
  return {
    polar_spike_passed: true,
    replay_passed: true,
    held_out_passed: true,
    security_scan_passed: true,
    complexity_budget_passed: true,
    target_failure_slice_improved: true,
    p0_p1_regressions: 0,
    token_turn_cost_regression_pct: 0.04,
  }
}

function promotionEvidenceSnapshot(): PromotionEvidenceSnapshot {
  return {
    replay_results: [{ passed: true }],
    held_out_results: [{ passed: true }],
    security_scan: { passed: true },
    complexity_budget: {
      passed: true,
      token_turn_cost_regression_pct: 0.04,
    },
    target_failure_slice: {
      before_success_rate: 0.5,
      after_success_rate: 0.7,
      min_delta: 0.05,
    },
    regressions: { p0_p1_count: 0 },
    polar_spike: { passed: true },
  }
}

function learningBundle(): LearningBundle {
  return {
    schema_version: 'leviathan.learning_bundle.v1',
    status: 'ready_for_activation',
    training_run_id: 'train_1',
    provider_model_id: 'mimo-v2.5',
    provider_model_update: 'none',
    stable_activation_allowed: true,
    heuristic_bundle: {
      version: 'hb:stable/train_1',
      source_candidate_bundle_version: 'hb:candidate/train_1',
      candidates: [
        {
          id: 'candidate_tool_choice_failure_001',
          type: 'candidate tool policy',
          status: 'candidate',
          source_failure_taxonomy: ['tool_choice_failure.bad_args'],
          feature_flag: 'hl.candidate.tool_choice_failure_001',
          rollback_plan:
            'Disable feature flag hl.candidate.tool_choice_failure_001',
        },
      ],
    },
    polar_harness: {
      version: 'polar:stable/train_1',
      source_candidate_harness_version: 'polar:candidate/train_1',
      updates: [
        {
          id: 'polar_candidate_proxy_bypass_001',
          status: 'candidate',
          failure_attribution: 'proxy_bypass',
          target_harness_asset: 'model_request_capture',
          source_cases: ['case_a_no_tool'],
          feature_flag: 'polar.candidate.proxy_bypass_001',
          rollback_plan: 'Disable feature flag polar.candidate.proxy_bypass_001',
        },
      ],
    },
    rollback: {
      feature_flags: [
        'hl.candidate.tool_choice_failure_001',
        'polar.candidate.proxy_bypass_001',
      ],
      plans: [
        'Disable feature flag hl.candidate.tool_choice_failure_001',
        'Disable feature flag polar.candidate.proxy_bypass_001',
      ],
    },
    blocked_reasons: [],
  }
}

async function withTempDir<T>(fn: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'leviathan-learning-command-'))
  try {
    return await fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('Leviathan learning command', () => {
  test('parses explicit training launch arguments', () => {
    expect(
      parseLearningCommandArgs(
        'start --config launch.json --out manifest.json --run-id train_1 --created-at 2026-06-03T12:00:00.000Z',
      ),
    ).toEqual({
      action: 'start',
      config_path: 'launch.json',
      output_path: 'manifest.json',
      run_id: 'train_1',
      created_at: '2026-06-03T12:00:00.000Z',
    })
  })

  test('parses launch config initialization arguments', () => {
    expect(
      parseLearningCommandArgs(
        'init --out launch.json --model mimo-v2.5 --git-commit abc123',
      ),
    ).toEqual({
      action: 'init',
      output_path: 'launch.json',
      provider_model_id: 'mimo-v2.5',
      git_commit: 'abc123',
    })
  })

  test('parses evidence collection arguments', () => {
    expect(
      parseLearningCommandArgs(
        'collect --out launch.json --model mimo-v2.5 --git-commit abc123 --rollout rollout-a.json --rollout rollout-b.json --replay replay.json',
      ),
    ).toEqual({
      action: 'collect',
      output_path: 'launch.json',
      provider_model_id: 'mimo-v2.5',
      provider_scope: 'anthropic-compatible-direct',
      git_commit: 'abc123',
      cwd_alias: '$WORKDIR',
      rollback_checkpoint_tag: 'checkpoint/hl-polar-readiness-foundation-v1.0',
      rollout_bundle_paths: ['rollout-a.json', 'rollout-b.json'],
      replay_results_path: 'replay.json',
    })
  })

  test('parses candidate heuristic training arguments', () => {
    expect(
      parseLearningCommandArgs(
        'train-candidates --out candidates.json --run-id train_1 --model mimo-v2.5 --base-bundle hb:initial --rollout rollout-a.json --rollout rollout-b.json',
      ),
    ).toEqual({
      action: 'train-candidates',
      output_path: 'candidates.json',
      training_run_id: 'train_1',
      provider_model_id: 'mimo-v2.5',
      base_heuristic_bundle_version: 'hb:initial',
      rollout_bundle_paths: ['rollout-a.json', 'rollout-b.json'],
    })
  })

  test('parses Polar harness training arguments', () => {
    expect(
      parseLearningCommandArgs(
        'train-polar --out polar.json --run-id train_1 --model mimo-v2.5 --base-harness git:abc123 --polar polar-observations.json',
      ),
    ).toEqual({
      action: 'train-polar',
      output_path: 'polar.json',
      training_run_id: 'train_1',
      provider_model_id: 'mimo-v2.5',
      base_harness_version: 'git:abc123',
      observations_path: 'polar-observations.json',
    })
  })

  test('parses candidate promotion report arguments', () => {
    expect(
      parseLearningCommandArgs(
        'promote-candidates --out promotion.json --candidates candidates.json --evidence evidence.json',
      ),
    ).toEqual({
      action: 'promote-candidates',
      output_path: 'promotion.json',
      training_path: 'candidates.json',
      evidence_path: 'evidence.json',
    })
  })

  test('parses Polar harness promotion report arguments', () => {
    expect(
      parseLearningCommandArgs(
        'promote-polar --out polar-promotion.json --polar-candidates polar.json --evidence evidence.json',
      ),
    ).toEqual({
      action: 'promote-polar',
      output_path: 'polar-promotion.json',
      training_path: 'polar.json',
      evidence_path: 'evidence.json',
    })
  })

  test('parses promotion evidence generation arguments', () => {
    expect(
      parseLearningCommandArgs(
        'promotion-evidence --snapshot eval.json --heuristic-out heuristic-evidence.json --polar-out polar-evidence.json',
      ),
    ).toEqual({
      action: 'promotion-evidence',
      snapshot_path: 'eval.json',
      heuristic_output_path: 'heuristic-evidence.json',
      polar_output_path: 'polar-evidence.json',
    })
  })

  test('parses evaluation snapshot generation arguments', () => {
    expect(
      parseLearningCommandArgs(
        'evaluation-snapshot --out snapshot.json --replay replay.json --held-out held-out-a.json --held-out held-out-b.json --security security.json --complexity complexity.json --target-slice target.json --regressions regressions.json --polar polar.json',
      ),
    ).toEqual({
      action: 'evaluation-snapshot',
      output_path: 'snapshot.json',
      replay_results_path: 'replay.json',
      held_out_rollout_paths: ['held-out-a.json', 'held-out-b.json'],
      security_scan_path: 'security.json',
      complexity_budget_path: 'complexity.json',
      target_failure_slice_path: 'target.json',
      regressions_path: 'regressions.json',
      polar_spike_observations_path: 'polar.json',
    })
  })

  test('parses full learning pipeline arguments', () => {
    expect(
      parseLearningCommandArgs(
        'run-pipeline --out-dir artifacts --run-id train_1 --model mimo-v2.5 --base-bundle hb:initial --base-harness git:abc123 --rollout train.json --held-out held.json --polar-training polar-train.json --polar-eval polar-eval.json --replay replay.json --security security.json --complexity complexity.json --target-slice target.json --regressions regressions.json',
      ),
    ).toEqual({
      action: 'run-pipeline',
      output_dir: 'artifacts',
      training_run_id: 'train_1',
      provider_model_id: 'mimo-v2.5',
      base_heuristic_bundle_version: 'hb:initial',
      base_harness_version: 'git:abc123',
      rollout_bundle_paths: ['train.json'],
      held_out_rollout_paths: ['held.json'],
      polar_training_observations_path: 'polar-train.json',
      polar_eval_observations_path: 'polar-eval.json',
      replay_results_path: 'replay.json',
      security_scan_path: 'security.json',
      complexity_budget_path: 'complexity.json',
      target_failure_slice_path: 'target.json',
      regressions_path: 'regressions.json',
    })
  })

  test('parses rollout annotation arguments', () => {
    expect(
      parseLearningCommandArgs(
        'annotate-rollout --input raw.json --out train.json --split train --taxonomy tool_choice_failure.bad_args --taxonomy verification_failure.flaky_tests --outcome unresolved --resolved-label false --root-cause "bad tool args" --test-cmd "bun test" --test-output "failed assertion" --exit-code 1 --changed-file src/commands/learning/learning.ts --export-allowed true --contains-private-code false',
      ),
    ).toEqual({
      action: 'annotate-rollout',
      input_path: 'raw.json',
      output_path: 'train.json',
      split: 'train',
      taxonomy: [
        'tool_choice_failure.bad_args',
        'verification_failure.flaky_tests',
      ],
      root_cause_summary: 'bad tool args',
      final_outcome: 'unresolved',
      resolved_label: false,
      test_commands: ['bun test'],
      test_outputs: ['failed assertion'],
      exit_codes: [1],
      changed_files: ['src/commands/learning/learning.ts'],
      export_allowed: true,
      contains_private_code: false,
    })
  })

  test('parses learning bundle activation arguments', () => {
    expect(
      parseLearningCommandArgs(
        'activate-bundle --bundle learning-bundle.json --state active-learning.json --activated-at 2026-06-04T12:00:00.000Z --activated-by slash-command',
      ),
    ).toEqual({
      action: 'activate-bundle',
      bundle_path: 'learning-bundle.json',
      state_path: 'active-learning.json',
      activated_at: '2026-06-04T12:00:00.000Z',
      activated_by: 'slash-command',
    })
  })

  test('parses learning bundle rollback arguments', () => {
    expect(
      parseLearningCommandArgs(
        'rollback-bundle --state active-learning.json --rolled-back-at 2026-06-04T13:00:00.000Z',
      ),
    ).toEqual({
      action: 'rollback-bundle',
      state_path: 'active-learning.json',
      rolled_back_at: '2026-06-04T13:00:00.000Z',
    })
  })

  test('leaves omitted rollout annotation evidence fields unset', () => {
    expect(
      parseLearningCommandArgs(
        'annotate-rollout --input raw.json --out train.json --taxonomy tool_choice_failure.bad_args',
      ),
    ).toEqual({
      action: 'annotate-rollout',
      input_path: 'raw.json',
      output_path: 'train.json',
      split: undefined,
      taxonomy: ['tool_choice_failure.bad_args'],
      root_cause_summary: undefined,
      final_outcome: undefined,
      resolved_label: undefined,
      test_commands: undefined,
      test_outputs: undefined,
      exit_codes: undefined,
      changed_files: undefined,
      diff: undefined,
      export_allowed: undefined,
      contains_private_code: undefined,
    })
  })

  test('writes a manifest from the slash command entrypoint', async () => {
    await withTempDir(async dir => {
      const configPath = join(dir, 'launch.json')
      const outputPath = join(dir, 'manifest.json')
      writeFileSync(configPath, JSON.stringify(readyLaunchConfig()), 'utf8')
      let doneMessage = ''

      await call(
        message => {
          doneMessage = message ?? ''
        },
        {} as never,
        `start --config ${configPath} --out ${outputPath} --run-id train_1 --created-at 2026-06-03T12:00:00.000Z`,
      )

      const manifest = JSON.parse(readFileSync(outputPath, 'utf8'))
      expect(manifest.status).toBe('started')
      expect(manifest.launch.mode).toBe('hl_polar_harness_learning')
      expect(doneMessage).toContain('Leviathan learning run started')
      expect(doneMessage).toContain(outputPath)
    })
  })

  test('registers /learning in built-in commands', async () => {
    const commands = await getCommands(process.cwd())
    const learning = commands.find(command => command.name === 'learning')

    expect(learning).toMatchObject({
      type: 'local-jsx',
      name: 'learning',
      description: 'Start or audit Leviathan HL + Polar harness learning',
    })
  })

  test('initializes a safe blocked launch config before evidence is collected', async () => {
    await withTempDir(async dir => {
      const configPath = join(dir, 'launch.json')
      const manifestPath = join(dir, 'manifest.json')
      let initDoneMessage = ''
      let startDoneMessage = ''

      await call(
        message => {
          initDoneMessage = message ?? ''
        },
        {} as never,
        `init --out ${configPath} --model mimo-v2.5 --git-commit abc123`,
      )

      const config = JSON.parse(readFileSync(configPath, 'utf8'))
      expect(config.provider_model_id).toBe('mimo-v2.5')
      expect(config.baseline_matrix.enabled_arms).toEqual([
        'baseline',
        'hl_only',
        'polar_only',
        'hl_polar',
      ])
      expect(Object.values(config.readiness_evidence).every(Boolean)).toBe(false)
      expect(initDoneMessage).toContain('Leviathan learning config initialized')

      await call(
        message => {
          startDoneMessage = message ?? ''
        },
        {} as never,
        `start --config ${configPath} --out ${manifestPath} --run-id train_blocked --created-at 2026-06-03T12:00:00.000Z`,
      )

      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      expect(manifest.status).toBe('blocked')
      expect(manifest.launch).toBe(null)
      expect(startDoneMessage).toContain('Leviathan learning run blocked')
    })
  })

  test('collects launch config evidence from rollout files', async () => {
    await withTempDir(async dir => {
      const rolloutPath = join(dir, 'rollout.json')
      const configPath = join(dir, 'launch.json')
      writeFileSync(rolloutPath, JSON.stringify(rolloutBundle()), 'utf8')
      let doneMessage = ''

      await call(
        message => {
          doneMessage = message ?? ''
        },
        {} as never,
        `collect --out ${configPath} --model mimo-v2.5 --git-commit abc123 --rollout ${rolloutPath}`,
      )

      const config = JSON.parse(readFileSync(configPath, 'utf8'))
      expect(config.rollout_bundle_count).toBe(1)
      expect(config.readiness_evidence.required_fields_landable).toBe(true)
      expect(config.readiness_evidence.replay_runner_fixed_task_reproducible).toBe(false)
      expect(config.readiness_evidence.rollback_and_incident_plan_ready).toBe(false)
      expect(doneMessage).toContain('Leviathan learning evidence collected')
      expect(doneMessage).toContain(configPath)
    })
  })

  test('trains candidate heuristics from rollout files through the slash command', async () => {
    await withTempDir(async dir => {
      const rolloutPath = join(dir, 'rollout.json')
      const outputPath = join(dir, 'candidate-heuristics.json')
      writeFileSync(rolloutPath, JSON.stringify(rolloutBundle()), 'utf8')
      let doneMessage = ''

      await call(
        message => {
          doneMessage = message ?? ''
        },
        {} as never,
        `train-candidates --out ${outputPath} --run-id train_1 --model mimo-v2.5 --base-bundle hb:initial --rollout ${rolloutPath}`,
      )

      const training = JSON.parse(readFileSync(outputPath, 'utf8'))
      expect(training.status).toBe('candidate_only')
      expect(training.provider_model_update).toBe('none')
      expect(training.stable_promotions_allowed).toBe(false)
      expect(training.candidates.map((candidate: { id: string }) => candidate.id)).toEqual([
        'candidate_tool_choice_failure_001',
      ])
      expect(doneMessage).toContain('Leviathan candidate heuristic training completed')
      expect(doneMessage).toContain(outputPath)
    })
  })

  test('annotates exported rollout files through the slash command', async () => {
    await withTempDir(async dir => {
      const inputPath = join(dir, 'raw-rollout.json')
      const outputPath = join(dir, 'train-rollout.json')
      writeFileSync(inputPath, JSON.stringify(rolloutBundle()), 'utf8')
      let doneMessage = ''

      await call(
        message => {
          doneMessage = message ?? ''
        },
        {} as never,
        `annotate-rollout --input ${inputPath} --out ${outputPath} --split train --taxonomy tool_choice_failure.bad_args --outcome unresolved --resolved-label false --root-cause "bad tool args" --test-cmd "bun test" --test-output "failed assertion" --exit-code 1 --changed-file src/commands/learning/learning.ts --export-allowed true --contains-private-code false`,
      )

      const annotated = JSON.parse(readFileSync(outputPath, 'utf8'))
      expect(annotated.run.split).toBe('train')
      expect(annotated.failure.taxonomy).toEqual([
        'tool_choice_failure.bad_args',
      ])
      expect(annotated.evaluation.final_outcome).toBe('unresolved')
      expect(annotated.evaluation.resolved_label).toBe(false)
      expect(annotated.security.export_allowed).toBe(true)
      expect(annotated.security.contains_private_code).toBe(false)
      expect(doneMessage).toContain('Leviathan rollout annotated')
      expect(doneMessage).toContain(outputPath)
    })
  })

  test('trains Polar harness candidates from observation files through the slash command', async () => {
    await withTempDir(async dir => {
      const observationsPath = join(dir, 'polar-observations.json')
      const outputPath = join(dir, 'polar-candidates.json')
      writeFileSync(
        observationsPath,
        JSON.stringify([
          polarObservation('case_a_no_tool', {
            captured_requests_count: 0,
          }),
          polarObservation('case_b_file_read_write'),
          polarObservation('case_c_test_execution'),
        ]),
        'utf8',
      )
      let doneMessage = ''

      await call(
        message => {
          doneMessage = message ?? ''
        },
        {} as never,
        `train-polar --out ${outputPath} --run-id train_1 --model mimo-v2.5 --base-harness git:abc123 --polar ${observationsPath}`,
      )

      const training = JSON.parse(readFileSync(outputPath, 'utf8'))
      expect(training.status).toBe('candidate_only')
      expect(training.provider_model_update).toBe('none')
      expect(training.stable_promotions_allowed).toBe(false)
      expect(training.updates.map((update: { id: string }) => update.id)).toEqual([
        'polar_candidate_proxy_bypass_001',
      ])
      expect(doneMessage).toContain('Leviathan Polar harness training completed')
      expect(doneMessage).toContain(outputPath)
    })
  })

  test('writes heuristic promotion reports through the slash command', async () => {
    await withTempDir(async dir => {
      const trainingPath = join(dir, 'candidate-heuristics.json')
      const evidencePath = join(dir, 'promotion-evidence.json')
      const outputPath = join(dir, 'promotion-report.json')
      writeFileSync(trainingPath, JSON.stringify(heuristicTrainingResult()), 'utf8')
      writeFileSync(evidencePath, JSON.stringify(promotionEvidence()), 'utf8')
      let doneMessage = ''

      await call(
        message => {
          doneMessage = message ?? ''
        },
        {} as never,
        `promote-candidates --out ${outputPath} --candidates ${trainingPath} --evidence ${evidencePath}`,
      )

      const report = JSON.parse(readFileSync(outputPath, 'utf8'))
      expect(report.status).toBe('ready_for_stable_promotion')
      expect(report.provider_model_update).toBe('none')
      expect(report.stable_promotions_allowed).toBe(true)
      expect(report.decisions.map((decision: { candidate_id: string }) => decision.candidate_id)).toEqual([
        'candidate_tool_choice_failure_001',
      ])
      expect(doneMessage).toContain('Leviathan heuristic promotion report ready')
      expect(doneMessage).toContain(outputPath)
    })
  })

  test('writes Polar harness promotion reports through the slash command', async () => {
    await withTempDir(async dir => {
      const trainingPath = join(dir, 'polar-candidates.json')
      const evidencePath = join(dir, 'polar-promotion-evidence.json')
      const outputPath = join(dir, 'polar-promotion-report.json')
      writeFileSync(
        trainingPath,
        JSON.stringify(polarHarnessTrainingResult()),
        'utf8',
      )
      writeFileSync(evidencePath, JSON.stringify(polarPromotionEvidence()), 'utf8')
      let doneMessage = ''

      await call(
        message => {
          doneMessage = message ?? ''
        },
        {} as never,
        `promote-polar --out ${outputPath} --polar-candidates ${trainingPath} --evidence ${evidencePath}`,
      )

      const report = JSON.parse(readFileSync(outputPath, 'utf8'))
      expect(report.status).toBe('ready_for_stable_promotion')
      expect(report.provider_model_update).toBe('none')
      expect(report.stable_promotions_allowed).toBe(true)
      expect(report.decisions.map((decision: { update_id: string }) => decision.update_id)).toEqual([
        'polar_candidate_proxy_bypass_001',
      ])
      expect(doneMessage).toContain('Leviathan Polar promotion report ready')
      expect(doneMessage).toContain(outputPath)
    })
  })

  test('writes promotion evidence files through the slash command', async () => {
    await withTempDir(async dir => {
      const snapshotPath = join(dir, 'promotion-snapshot.json')
      const heuristicPath = join(dir, 'heuristic-evidence.json')
      const polarPath = join(dir, 'polar-evidence.json')
      writeFileSync(snapshotPath, JSON.stringify(promotionEvidenceSnapshot()), 'utf8')
      let doneMessage = ''

      await call(
        message => {
          doneMessage = message ?? ''
        },
        {} as never,
        `promotion-evidence --snapshot ${snapshotPath} --heuristic-out ${heuristicPath} --polar-out ${polarPath}`,
      )

      const heuristicEvidence = JSON.parse(readFileSync(heuristicPath, 'utf8'))
      const polarEvidence = JSON.parse(readFileSync(polarPath, 'utf8'))
      expect(heuristicEvidence.target_failure_slice_improved).toBe(true)
      expect(polarEvidence.polar_spike_passed).toBe(true)
      expect(doneMessage).toContain('Leviathan promotion evidence written')
      expect(doneMessage).toContain(heuristicPath)
      expect(doneMessage).toContain(polarPath)
    })
  })

  test('writes evaluation snapshot files through the slash command', async () => {
    await withTempDir(async dir => {
      const replayPath = join(dir, 'replay.json')
      const heldOutPath = join(dir, 'held-out.json')
      const securityPath = join(dir, 'security.json')
      const complexityPath = join(dir, 'complexity.json')
      const targetSlicePath = join(dir, 'target-slice.json')
      const regressionsPath = join(dir, 'regressions.json')
      const polarPath = join(dir, 'polar.json')
      const outputPath = join(dir, 'promotion-snapshot.json')
      writeFileSync(replayPath, JSON.stringify([{ passed: true }]), 'utf8')
      writeFileSync(heldOutPath, JSON.stringify(rolloutBundle()), 'utf8')
      writeFileSync(securityPath, JSON.stringify({ passed: true }), 'utf8')
      writeFileSync(
        complexityPath,
        JSON.stringify({
          passed: true,
          token_turn_cost_regression_pct: 0.04,
        }),
        'utf8',
      )
      writeFileSync(
        targetSlicePath,
        JSON.stringify({
          before_success_rate: 0.5,
          after_success_rate: 0.7,
          min_delta: 0.05,
        }),
        'utf8',
      )
      writeFileSync(regressionsPath, JSON.stringify({ p0_p1_count: 0 }), 'utf8')
      writeFileSync(
        polarPath,
        JSON.stringify([
          polarObservation('case_a_no_tool'),
          polarObservation('case_b_file_read_write'),
          polarObservation('case_c_test_execution'),
        ]),
        'utf8',
      )
      let doneMessage = ''

      await call(
        message => {
          doneMessage = message ?? ''
        },
        {} as never,
        `evaluation-snapshot --out ${outputPath} --replay ${replayPath} --held-out ${heldOutPath} --security ${securityPath} --complexity ${complexityPath} --target-slice ${targetSlicePath} --regressions ${regressionsPath} --polar ${polarPath}`,
      )

      const snapshot = JSON.parse(readFileSync(outputPath, 'utf8'))
      expect(snapshot.replay_results).toEqual([{ passed: true }])
      expect(snapshot.held_out_results).toEqual([{ passed: false }])
      expect(snapshot.polar_spike).toEqual({ passed: true })
      expect(doneMessage).toContain('Leviathan evaluation snapshot written')
      expect(doneMessage).toContain(outputPath)
    })
  })

  test('runs the full learning pipeline through the slash command', async () => {
    await withTempDir(async dir => {
      const rolloutPath = join(dir, 'training-rollout.json')
      const heldOutPath = join(dir, 'held-out-rollout.json')
      const polarTrainingPath = join(dir, 'polar-training.json')
      const polarEvalPath = join(dir, 'polar-eval.json')
      const replayPath = join(dir, 'replay.json')
      const securityPath = join(dir, 'security.json')
      const complexityPath = join(dir, 'complexity.json')
      const targetSlicePath = join(dir, 'target-slice.json')
      const regressionsPath = join(dir, 'regressions.json')
      const outputDir = join(dir, 'artifacts')
      writeFileSync(rolloutPath, JSON.stringify(rolloutBundle()), 'utf8')
      writeFileSync(
        heldOutPath,
        JSON.stringify(resolvedHeldOutRolloutBundle()),
        'utf8',
      )
      writeFileSync(
        polarTrainingPath,
        JSON.stringify([
          polarObservation('case_a_no_tool', {
            captured_requests_count: 0,
          }),
          polarObservation('case_b_file_read_write'),
          polarObservation('case_c_test_execution'),
        ]),
        'utf8',
      )
      writeFileSync(
        polarEvalPath,
        JSON.stringify([
          polarObservation('case_a_no_tool'),
          polarObservation('case_b_file_read_write'),
          polarObservation('case_c_test_execution'),
        ]),
        'utf8',
      )
      writeFileSync(replayPath, JSON.stringify([{ passed: true }]), 'utf8')
      writeFileSync(securityPath, JSON.stringify({ passed: true }), 'utf8')
      writeFileSync(
        complexityPath,
        JSON.stringify({
          passed: true,
          token_turn_cost_regression_pct: 0.04,
        }),
        'utf8',
      )
      writeFileSync(
        targetSlicePath,
        JSON.stringify({
          before_success_rate: 0.5,
          after_success_rate: 0.7,
          min_delta: 0.05,
        }),
        'utf8',
      )
      writeFileSync(regressionsPath, JSON.stringify({ p0_p1_count: 0 }), 'utf8')
      let doneMessage = ''

      await call(
        message => {
          doneMessage = message ?? ''
        },
        {} as never,
        `run-pipeline --out-dir ${outputDir} --run-id train_1 --model mimo-v2.5 --base-bundle hb:initial --base-harness git:abc123 --rollout ${rolloutPath} --held-out ${heldOutPath} --polar-training ${polarTrainingPath} --polar-eval ${polarEvalPath} --replay ${replayPath} --security ${securityPath} --complexity ${complexityPath} --target-slice ${targetSlicePath} --regressions ${regressionsPath}`,
      )

      const manifest = JSON.parse(
        readFileSync(join(outputDir, 'learning-pipeline-manifest.json'), 'utf8'),
      )
      expect(manifest.status).toBe('ready_for_stable_promotion')
      expect(manifest.provider_model_update).toBe('none')
      expect(manifest.stable_promotion_ready).toBe(true)
      expect(doneMessage).toContain('Leviathan learning pipeline ready')
      expect(doneMessage).toContain(outputDir)
    })
  })

  test('activates a learning bundle through the slash command', async () => {
    await withTempDir(async dir => {
      const bundlePath = join(dir, 'learning-bundle.json')
      const statePath = join(dir, 'active-learning.json')
      writeFileSync(bundlePath, JSON.stringify(learningBundle()), 'utf8')
      let doneMessage = ''

      await call(
        message => {
          doneMessage = message ?? ''
        },
        {} as never,
        `activate-bundle --bundle ${bundlePath} --state ${statePath} --activated-at 2026-06-04T12:00:00.000Z --activated-by slash-command`,
      )

      const state = JSON.parse(readFileSync(statePath, 'utf8'))
      expect(state.status).toBe('active')
      expect(state.training_run_id).toBe('train_1')
      expect(state.heuristic_bundle_version).toBe('hb:stable/train_1')
      expect(state.polar_harness_version).toBe('polar:stable/train_1')
      expect(doneMessage).toContain('Leviathan learning bundle activated')
      expect(doneMessage).toContain(statePath)
    })
  })

  test('rolls back active learning state through the slash command', async () => {
    await withTempDir(async dir => {
      const firstBundlePath = join(dir, 'first-learning-bundle.json')
      const secondBundlePath = join(dir, 'second-learning-bundle.json')
      const statePath = join(dir, 'active-learning.json')
      writeFileSync(firstBundlePath, JSON.stringify(learningBundle()), 'utf8')
      writeFileSync(
        secondBundlePath,
        JSON.stringify({
          ...learningBundle(),
          training_run_id: 'train_2',
          heuristic_bundle: {
            ...learningBundle().heuristic_bundle,
            version: 'hb:stable/train_2',
          },
          polar_harness: {
            ...learningBundle().polar_harness,
            version: 'polar:stable/train_2',
          },
        }),
        'utf8',
      )

      await call(
        () => {},
        {} as never,
        `activate-bundle --bundle ${firstBundlePath} --state ${statePath} --activated-at 2026-06-04T12:00:00.000Z`,
      )
      await call(
        () => {},
        {} as never,
        `activate-bundle --bundle ${secondBundlePath} --state ${statePath} --activated-at 2026-06-04T13:00:00.000Z`,
      )
      let doneMessage = ''

      await call(
        message => {
          doneMessage = message ?? ''
        },
        {} as never,
        `rollback-bundle --state ${statePath} --rolled-back-at 2026-06-04T14:00:00.000Z`,
      )

      const state = JSON.parse(readFileSync(statePath, 'utf8'))
      expect(state.training_run_id).toBe('train_1')
      expect(state.heuristic_bundle_version).toBe('hb:stable/train_1')
      expect(doneMessage).toContain('Leviathan learning bundle rolled back')
      expect(doneMessage).toContain(statePath)
    })
  })
})
