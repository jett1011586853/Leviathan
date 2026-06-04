import type { LocalJSXCommandOnDone } from '../../types/command.js'
import {
  createDefaultTrainingLaunchConfig,
  launchTrainingRunFromConfigFile,
  writeTrainingLaunchConfigFile,
} from '../../learning/trainingRunFiles.js'
import { buildTrainingLaunchConfigFromEvidenceFiles } from '../../learning/trainingEvidenceFiles.js'
import type { ProviderScope } from '../../learning/trainingReadinessEvidence.js'
import { trainHeuristicCandidatesFromFiles } from '../../learning/heuristicTrainingFiles.js'
import { trainPolarHarnessCandidatesFromFiles } from '../../learning/polarHarnessTrainingFiles.js'
import { writeHeuristicPromotionReportFromFiles } from '../../learning/promotionFiles.js'
import { writePolarHarnessPromotionReportFromFiles } from '../../learning/polarHarnessPromotionFiles.js'
import { writePromotionEvidenceFromSnapshotFiles } from '../../learning/promotionEvidenceFiles.js'
import { writeEvaluationSnapshotFromFiles } from '../../learning/evaluationSnapshotFiles.js'
import { runLearningPipelineFromFiles } from '../../learning/learningPipelineFiles.js'

export type ParsedLearningCommandArgs =
  | {
      action: 'start'
      config_path: string
      output_path: string
      run_id?: string
      created_at?: string
    }
  | {
      action: 'init'
      output_path: string
      provider_model_id: string
      git_commit: string
    }
  | {
      action: 'collect'
      output_path: string
      provider_model_id: string
      provider_scope: ProviderScope
      git_commit: string
      cwd_alias: string
      rollback_checkpoint_tag: string
      rollout_bundle_paths: string[]
      replay_results_path?: string
      benchmark_records_path?: string
      polar_spike_observations_path?: string
      reward_design_path?: string
      baseline_matrix_path?: string
      rollback_incident_plan_path?: string
    }
  | {
      action: 'train-candidates'
      output_path: string
      training_run_id: string
      provider_model_id: string
      base_heuristic_bundle_version: string
      rollout_bundle_paths: string[]
    }
  | {
      action: 'train-polar'
      output_path: string
      training_run_id: string
      provider_model_id: string
      base_harness_version: string
      observations_path: string
    }
  | {
      action: 'promote-candidates'
      output_path: string
      training_path: string
      evidence_path: string
    }
  | {
      action: 'promote-polar'
      output_path: string
      training_path: string
      evidence_path: string
    }
  | {
      action: 'promotion-evidence'
      snapshot_path: string
      heuristic_output_path: string
      polar_output_path: string
    }
  | {
      action: 'evaluation-snapshot'
      output_path: string
      replay_results_path: string
      held_out_rollout_paths: string[]
      security_scan_path: string
      complexity_budget_path: string
      target_failure_slice_path: string
      regressions_path: string
      polar_spike_observations_path: string
    }
  | {
      action: 'run-pipeline'
      output_dir: string
      training_run_id: string
      provider_model_id: string
      base_heuristic_bundle_version: string
      base_harness_version: string
      rollout_bundle_paths: string[]
      held_out_rollout_paths: string[]
      polar_training_observations_path: string
      polar_eval_observations_path: string
      replay_results_path: string
      security_scan_path: string
      complexity_budget_path: string
      target_failure_slice_path: string
      regressions_path: string
    }
  | {
      action: 'help'
    }

const USAGE =
  'Usage: /learning init --out <launch.json> --model <model-id>; /learning collect --out <launch.json> --model <model-id> --rollout <rollout.json>; /learning start --config <launch.json> --out <manifest.json>; /learning train-candidates --out <candidates.json> --run-id <run> --model <model-id> --rollout <rollout.json>; /learning train-polar --out <polar.json> --run-id <run> --model <model-id> --polar <observations.json>; /learning evaluation-snapshot --out <snapshot.json> --replay <replay.json> --held-out <rollout.json> --security <scan.json> --complexity <budget.json> --target-slice <slice.json> --regressions <regressions.json> --polar <observations.json>; /learning promotion-evidence --snapshot <eval.json> --heuristic-out <evidence.json> --polar-out <evidence.json>; /learning promote-candidates --out <promotion.json> --candidates <candidates.json> --evidence <evidence.json>; /learning promote-polar --out <promotion.json> --polar-candidates <polar.json> --evidence <evidence.json>; /learning run-pipeline --out-dir <dir> --run-id <run> --model <model-id> --rollout <rollout.json> --held-out <rollout.json> --polar-training <observations.json> --polar-eval <observations.json> --replay <replay.json> --security <scan.json> --complexity <budget.json> --target-slice <slice.json> --regressions <regressions.json>'

function tokenizeArgs(args: string): string[] {
  const tokens: string[] = []
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g
  let match: RegExpExecArray | null

  while ((match = pattern.exec(args)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? '')
  }

  return tokens
}

function readFlag(tokens: string[], names: string[]): string {
  for (const name of names) {
    const equalsToken = tokens.find(token => token.startsWith(`${name}=`))
    if (equalsToken) return equalsToken.slice(name.length + 1)

    const index = tokens.indexOf(name)
    if (index >= 0 && index + 1 < tokens.length) return tokens[index + 1] ?? ''
  }

  return ''
}

function readFlags(tokens: string[], names: string[]): string[] {
  const values: string[] = []

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index] ?? ''
    for (const name of names) {
      if (token.startsWith(`${name}=`)) {
        values.push(token.slice(name.length + 1))
      } else if (token === name && index + 1 < tokens.length) {
        values.push(tokens[index + 1] ?? '')
      }
    }
  }

  return values.filter(value => value.trim().length > 0)
}

export function parseLearningCommandArgs(
  args: string,
): ParsedLearningCommandArgs {
  const tokens = tokenizeArgs(args.trim())
  if (tokens[0] === 'init') {
    const output_path = readFlag(tokens, ['--out', '--output'])
    const provider_model_id = readFlag(tokens, ['--model'])
    if (!output_path || !provider_model_id) return { action: 'help' }

    return {
      action: 'init',
      output_path,
      provider_model_id,
      git_commit: readFlag(tokens, ['--git-commit']) || 'unknown',
    }
  }

  if (tokens[0] === 'collect') {
    const output_path = readFlag(tokens, ['--out', '--output'])
    const provider_model_id = readFlag(tokens, ['--model'])
    const rollout_bundle_paths = readFlags(tokens, ['--rollout'])
    if (!output_path || !provider_model_id || rollout_bundle_paths.length === 0) {
      return { action: 'help' }
    }

    return {
      action: 'collect',
      output_path,
      provider_model_id,
      provider_scope:
        (readFlag(tokens, ['--provider-scope']) as ProviderScope) ||
        'anthropic-compatible-direct',
      git_commit: readFlag(tokens, ['--git-commit']) || 'unknown',
      cwd_alias: readFlag(tokens, ['--cwd-alias']) || '$WORKDIR',
      rollback_checkpoint_tag:
        readFlag(tokens, ['--checkpoint']) ||
        'checkpoint/hl-polar-readiness-foundation-v1.0',
      rollout_bundle_paths,
      replay_results_path: readFlag(tokens, ['--replay']) || undefined,
      benchmark_records_path: readFlag(tokens, ['--benchmarks']) || undefined,
      polar_spike_observations_path: readFlag(tokens, ['--polar']) || undefined,
      reward_design_path: readFlag(tokens, ['--reward']) || undefined,
      baseline_matrix_path: readFlag(tokens, ['--baseline']) || undefined,
      rollback_incident_plan_path: readFlag(tokens, ['--rollback']) || undefined,
    }
  }

  if (tokens[0] === 'train-candidates') {
    const output_path = readFlag(tokens, ['--out', '--output'])
    const training_run_id = readFlag(tokens, ['--run-id'])
    const provider_model_id = readFlag(tokens, ['--model'])
    const rollout_bundle_paths = readFlags(tokens, ['--rollout'])
    if (
      !output_path ||
      !training_run_id ||
      !provider_model_id ||
      rollout_bundle_paths.length === 0
    ) {
      return { action: 'help' }
    }

    return {
      action: 'train-candidates',
      output_path,
      training_run_id,
      provider_model_id,
      base_heuristic_bundle_version:
        readFlag(tokens, ['--base-bundle']) || 'hb:initial',
      rollout_bundle_paths,
    }
  }

  if (tokens[0] === 'train-polar') {
    const output_path = readFlag(tokens, ['--out', '--output'])
    const training_run_id = readFlag(tokens, ['--run-id'])
    const provider_model_id = readFlag(tokens, ['--model'])
    const observations_path = readFlag(tokens, ['--polar'])
    if (
      !output_path ||
      !training_run_id ||
      !provider_model_id ||
      !observations_path
    ) {
      return { action: 'help' }
    }

    return {
      action: 'train-polar',
      output_path,
      training_run_id,
      provider_model_id,
      base_harness_version: readFlag(tokens, ['--base-harness']) || 'unknown',
      observations_path,
    }
  }

  if (tokens[0] === 'promote-candidates') {
    const output_path = readFlag(tokens, ['--out', '--output'])
    const training_path = readFlag(tokens, ['--candidates', '--training'])
    const evidence_path = readFlag(tokens, ['--evidence'])
    if (!output_path || !training_path || !evidence_path) {
      return { action: 'help' }
    }

    return {
      action: 'promote-candidates',
      output_path,
      training_path,
      evidence_path,
    }
  }

  if (tokens[0] === 'promote-polar') {
    const output_path = readFlag(tokens, ['--out', '--output'])
    const training_path = readFlag(tokens, ['--polar-candidates', '--training'])
    const evidence_path = readFlag(tokens, ['--evidence'])
    if (!output_path || !training_path || !evidence_path) {
      return { action: 'help' }
    }

    return {
      action: 'promote-polar',
      output_path,
      training_path,
      evidence_path,
    }
  }

  if (tokens[0] === 'promotion-evidence') {
    const snapshot_path = readFlag(tokens, ['--snapshot'])
    const heuristic_output_path = readFlag(tokens, [
      '--heuristic-out',
      '--heuristic-output',
    ])
    const polar_output_path = readFlag(tokens, ['--polar-out', '--polar-output'])
    if (!snapshot_path || !heuristic_output_path || !polar_output_path) {
      return { action: 'help' }
    }

    return {
      action: 'promotion-evidence',
      snapshot_path,
      heuristic_output_path,
      polar_output_path,
    }
  }

  if (tokens[0] === 'evaluation-snapshot') {
    const output_path = readFlag(tokens, ['--out', '--output'])
    const replay_results_path = readFlag(tokens, ['--replay'])
    const held_out_rollout_paths = readFlags(tokens, ['--held-out'])
    const security_scan_path = readFlag(tokens, ['--security'])
    const complexity_budget_path = readFlag(tokens, ['--complexity'])
    const target_failure_slice_path = readFlag(tokens, ['--target-slice'])
    const regressions_path = readFlag(tokens, ['--regressions'])
    const polar_spike_observations_path = readFlag(tokens, ['--polar'])
    if (
      !output_path ||
      !replay_results_path ||
      held_out_rollout_paths.length === 0 ||
      !security_scan_path ||
      !complexity_budget_path ||
      !target_failure_slice_path ||
      !regressions_path ||
      !polar_spike_observations_path
    ) {
      return { action: 'help' }
    }

    return {
      action: 'evaluation-snapshot',
      output_path,
      replay_results_path,
      held_out_rollout_paths,
      security_scan_path,
      complexity_budget_path,
      target_failure_slice_path,
      regressions_path,
      polar_spike_observations_path,
    }
  }

  if (tokens[0] === 'run-pipeline') {
    const output_dir = readFlag(tokens, ['--out-dir', '--output-dir'])
    const training_run_id = readFlag(tokens, ['--run-id'])
    const provider_model_id = readFlag(tokens, ['--model'])
    const rollout_bundle_paths = readFlags(tokens, ['--rollout'])
    const held_out_rollout_paths = readFlags(tokens, ['--held-out'])
    const polar_training_observations_path = readFlag(tokens, [
      '--polar-training',
    ])
    const polar_eval_observations_path = readFlag(tokens, ['--polar-eval'])
    const replay_results_path = readFlag(tokens, ['--replay'])
    const security_scan_path = readFlag(tokens, ['--security'])
    const complexity_budget_path = readFlag(tokens, ['--complexity'])
    const target_failure_slice_path = readFlag(tokens, ['--target-slice'])
    const regressions_path = readFlag(tokens, ['--regressions'])
    if (
      !output_dir ||
      !training_run_id ||
      !provider_model_id ||
      rollout_bundle_paths.length === 0 ||
      held_out_rollout_paths.length === 0 ||
      !polar_training_observations_path ||
      !polar_eval_observations_path ||
      !replay_results_path ||
      !security_scan_path ||
      !complexity_budget_path ||
      !target_failure_slice_path ||
      !regressions_path
    ) {
      return { action: 'help' }
    }

    return {
      action: 'run-pipeline',
      output_dir,
      training_run_id,
      provider_model_id,
      base_heuristic_bundle_version:
        readFlag(tokens, ['--base-bundle']) || 'hb:initial',
      base_harness_version: readFlag(tokens, ['--base-harness']) || 'unknown',
      rollout_bundle_paths,
      held_out_rollout_paths,
      polar_training_observations_path,
      polar_eval_observations_path,
      replay_results_path,
      security_scan_path,
      complexity_budget_path,
      target_failure_slice_path,
      regressions_path,
    }
  }

  if (tokens[0] !== 'start') return { action: 'help' }

  const config_path = readFlag(tokens, ['--config'])
  const output_path = readFlag(tokens, ['--out', '--output'])
  if (!config_path || !output_path) return { action: 'help' }

  return {
    action: 'start',
    config_path,
    output_path,
    run_id: readFlag(tokens, ['--run-id']) || undefined,
    created_at: readFlag(tokens, ['--created-at']) || undefined,
  }
}

function defaultRunId(createdAt: string): string {
  return `train_${createdAt.replace(/[^0-9]/g, '').slice(0, 14)}`
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: unknown,
  args: string,
): Promise<null> {
  const parsed = parseLearningCommandArgs(args)
  if (parsed.action === 'help') {
    onDone(USAGE)
    return null
  }

  if (parsed.action === 'init') {
    writeTrainingLaunchConfigFile(
      parsed.output_path,
      createDefaultTrainingLaunchConfig({
        provider_model_id: parsed.provider_model_id,
        git_commit: parsed.git_commit,
      }),
    )
    onDone(`Leviathan learning config initialized: ${parsed.output_path}`)
    return null
  }

  if (parsed.action === 'collect') {
    writeTrainingLaunchConfigFile(
      parsed.output_path,
      buildTrainingLaunchConfigFromEvidenceFiles({
        provider_model_id: parsed.provider_model_id,
        provider_scope: parsed.provider_scope,
        git_commit: parsed.git_commit,
        cwd_alias: parsed.cwd_alias,
        rollback_checkpoint_tag: parsed.rollback_checkpoint_tag,
        rollout_bundle_paths: parsed.rollout_bundle_paths,
        replay_results_path: parsed.replay_results_path,
        benchmark_records_path: parsed.benchmark_records_path,
        polar_spike_observations_path: parsed.polar_spike_observations_path,
        reward_design_path: parsed.reward_design_path,
        baseline_matrix_path: parsed.baseline_matrix_path,
        rollback_incident_plan_path: parsed.rollback_incident_plan_path,
      }),
    )
    onDone(`Leviathan learning evidence collected: ${parsed.output_path}`)
    return null
  }

  if (parsed.action === 'train-candidates') {
    const result = trainHeuristicCandidatesFromFiles({
      training_run_id: parsed.training_run_id,
      provider_model_id: parsed.provider_model_id,
      base_heuristic_bundle_version: parsed.base_heuristic_bundle_version,
      rollout_bundle_paths: parsed.rollout_bundle_paths,
      output_path: parsed.output_path,
    })
    if (result.training.status === 'candidate_only') {
      onDone(
        `Leviathan candidate heuristic training completed: ${result.output_path}`,
      )
      return null
    }
    onDone(
      `Leviathan candidate heuristic training blocked: ${result.training.blocked_reasons.join(
        ', ',
      )}. Output: ${result.output_path}`,
    )
    return null
  }

  if (parsed.action === 'train-polar') {
    const result = trainPolarHarnessCandidatesFromFiles({
      training_run_id: parsed.training_run_id,
      provider_model_id: parsed.provider_model_id,
      base_harness_version: parsed.base_harness_version,
      observations_path: parsed.observations_path,
      output_path: parsed.output_path,
    })
    if (result.training.status === 'candidate_only') {
      onDone(`Leviathan Polar harness training completed: ${result.output_path}`)
      return null
    }
    onDone(
      `Leviathan Polar harness training blocked: ${result.training.blocked_reasons.join(
        ', ',
      )}. Output: ${result.output_path}`,
    )
    return null
  }

  if (parsed.action === 'promote-candidates') {
    const result = writeHeuristicPromotionReportFromFiles({
      training_path: parsed.training_path,
      evidence_path: parsed.evidence_path,
      output_path: parsed.output_path,
    })
    if (result.report.status === 'ready_for_stable_promotion') {
      onDone(`Leviathan heuristic promotion report ready: ${result.output_path}`)
      return null
    }
    onDone(
      `Leviathan heuristic promotion report ${result.report.status}: ${result.report.blocked_reasons.join(
        ', ',
      )}. Output: ${result.output_path}`,
    )
    return null
  }

  if (parsed.action === 'promote-polar') {
    const result = writePolarHarnessPromotionReportFromFiles({
      training_path: parsed.training_path,
      evidence_path: parsed.evidence_path,
      output_path: parsed.output_path,
    })
    if (result.report.status === 'ready_for_stable_promotion') {
      onDone(`Leviathan Polar promotion report ready: ${result.output_path}`)
      return null
    }
    onDone(
      `Leviathan Polar promotion report ${result.report.status}: ${result.report.blocked_reasons.join(
        ', ',
      )}. Output: ${result.output_path}`,
    )
    return null
  }

  if (parsed.action === 'promotion-evidence') {
    const result = writePromotionEvidenceFromSnapshotFiles({
      snapshot_path: parsed.snapshot_path,
      heuristic_output_path: parsed.heuristic_output_path,
      polar_output_path: parsed.polar_output_path,
    })
    onDone(
      `Leviathan promotion evidence written: ${result.heuristic_output_path}; ${result.polar_output_path}`,
    )
    return null
  }

  if (parsed.action === 'evaluation-snapshot') {
    const result = writeEvaluationSnapshotFromFiles({
      output_path: parsed.output_path,
      replay_results_path: parsed.replay_results_path,
      held_out_rollout_paths: parsed.held_out_rollout_paths,
      security_scan_path: parsed.security_scan_path,
      complexity_budget_path: parsed.complexity_budget_path,
      target_failure_slice_path: parsed.target_failure_slice_path,
      regressions_path: parsed.regressions_path,
      polar_spike_observations_path: parsed.polar_spike_observations_path,
    })
    onDone(`Leviathan evaluation snapshot written: ${result.output_path}`)
    return null
  }

  if (parsed.action === 'run-pipeline') {
    const result = runLearningPipelineFromFiles({
      output_dir: parsed.output_dir,
      training_run_id: parsed.training_run_id,
      provider_model_id: parsed.provider_model_id,
      base_heuristic_bundle_version: parsed.base_heuristic_bundle_version,
      base_harness_version: parsed.base_harness_version,
      rollout_bundle_paths: parsed.rollout_bundle_paths,
      held_out_rollout_paths: parsed.held_out_rollout_paths,
      polar_training_observations_path: parsed.polar_training_observations_path,
      polar_eval_observations_path: parsed.polar_eval_observations_path,
      replay_results_path: parsed.replay_results_path,
      security_scan_path: parsed.security_scan_path,
      complexity_budget_path: parsed.complexity_budget_path,
      target_failure_slice_path: parsed.target_failure_slice_path,
      regressions_path: parsed.regressions_path,
    })
    if (result.manifest.status === 'ready_for_stable_promotion') {
      onDone(`Leviathan learning pipeline ready: ${parsed.output_dir}`)
      return null
    }
    onDone(
      `Leviathan learning pipeline ${result.manifest.status}: ${parsed.output_dir}`,
    )
    return null
  }

  const created_at = parsed.created_at ?? new Date().toISOString()
  const result = launchTrainingRunFromConfigFile({
    config_path: parsed.config_path,
    output_path: parsed.output_path,
    run_id: parsed.run_id ?? defaultRunId(created_at),
    created_at,
  })

  if (result.manifest.status === 'started') {
    onDone(`Leviathan learning run started: ${result.output_path}`)
    return null
  }

  onDone(
    `Leviathan learning run blocked: ${result.manifest.blocked?.reasons.join(
      ', ',
    )}. Manifest: ${result.output_path}`,
  )
  return null
}
