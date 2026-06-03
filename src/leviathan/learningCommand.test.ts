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
})
