import { mkdirSync, readFileSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join } from 'node:path'

import {
  annotateRolloutFile,
  assertTrainableRolloutRootCause,
  type AnnotateRolloutFileInput,
} from './rolloutAnnotationFiles.js'
import type { LeviathanRolloutBundle } from './rolloutSchema.js'
import type { ShadowLearningRun } from './shadowLearningRunFiles.js'
import {
  writeShadowLearningRunStatusFile,
  type ShadowLearningRunStatusSnapshot,
} from './shadowLearningRunStatusFiles.js'
import {
  jsonParse,
  jsonStringify,
  writeFileSync_DEPRECATED,
} from '../utils/slowOperations.js'

export const SHADOW_ROLLOUT_INTAKE_SCHEMA_VERSION =
  'leviathan.shadow_rollout_intake.v1' as const

export type ShadowRolloutIntakeSplit = 'train' | 'dev' | 'held_out'

export type IntakeShadowRolloutFileInput = {
  run_dir: string
  input_path: string
  split?: ShadowRolloutIntakeSplit
  taxonomy?: string[]
  root_cause_summary?: string
  final_outcome?: AnnotateRolloutFileInput['final_outcome']
  resolved_label?: boolean | null
  test_commands?: string[]
  test_outputs?: string[]
  exit_codes?: number[]
  changed_files?: string[]
  diff?: string
  export_allowed?: boolean
  contains_private_code?: boolean
}

export type WriteShadowRolloutIntakeReportInput =
  IntakeShadowRolloutFileInput & {
    output_path?: string
  }

export type ShadowRolloutIntakeReport = {
  schema_version: typeof SHADOW_ROLLOUT_INTAKE_SCHEMA_VERSION
  run_id: string
  source_path: string
  raw_path: string
  annotated_path: string | null
  split: ShadowRolloutIntakeSplit | null
  taxonomy: string[]
  provider_model_id: string
  provider_model_update: 'none'
  status_path: string
  status: ShadowLearningRunStatusSnapshot
}

export type IntakeShadowRolloutFileResult = {
  report: ShadowRolloutIntakeReport
}

export type WriteShadowRolloutIntakeReportResult =
  IntakeShadowRolloutFileResult & {
    output_path: string
  }

function readJsonFile<T>(path: string): T {
  return jsonParse(readFileSync(path, 'utf8')) as T
}

function writeJsonFile(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync_DEPRECATED(path, jsonStringify(value, null, 2), {
    encoding: 'utf-8',
    flush: true,
  })
}

function resolveRunPath(
  runDir: string,
  path: string | undefined,
  fallback: string,
): string {
  if (!path) return join(runDir, fallback)
  return isAbsolute(path) ? path : path
}

function safeFileStem(value: string): string {
  return (
    value
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120) || 'rollout'
  )
}

function rolloutFileStem(
  rollout: LeviathanRolloutBundle,
  inputPath?: string,
): string {
  const fallback = inputPath
    ? basename(inputPath, extname(inputPath) || '.json')
    : 'rollout'
  return safeFileStem(rollout.run.task_id || rollout.run.run_id || fallback)
}

function rolloutFileName(rollout: LeviathanRolloutBundle, inputPath: string): string {
  const ext = extname(inputPath) || '.json'
  return `${rolloutFileStem(rollout, inputPath)}${ext}`
}

function annotatedDirForSplit(
  run: ShadowLearningRun,
  split: ShadowRolloutIntakeSplit,
): string {
  if (split === 'train') return run.artifacts.annotated_train_dir
  if (split === 'dev') return run.artifacts.annotated_dev_dir
  return run.artifacts.annotated_held_out_dir
}

function rolloutSchemaSplit(
  split: ShadowRolloutIntakeSplit,
): LeviathanRolloutBundle['run']['split'] {
  return split === 'held_out' ? 'test' : split
}

function shouldAnnotate(input: IntakeShadowRolloutFileInput): boolean {
  return (
    input.split !== undefined &&
    input.taxonomy !== undefined &&
    input.taxonomy.some(value => value.trim().length > 0)
  )
}

function validateTrainableIntakeRootCause(
  input: IntakeShadowRolloutFileInput,
  rollout: LeviathanRolloutBundle,
): void {
  if (!shouldAnnotate(input)) return
  const split = input.split as ShadowRolloutIntakeSplit
  assertTrainableRolloutRootCause({
    split: rolloutSchemaSplit(split),
    taxonomy: input.taxonomy ?? [],
    root_cause_summary:
      input.root_cause_summary !== undefined
        ? input.root_cause_summary
        : rollout.failure.root_cause_summary,
  })
}

function statusPath(runDir: string): string {
  return join(runDir, 'shadow-status.json')
}

function defaultReportPath(
  runDir: string,
  rollout: LeviathanRolloutBundle,
): string {
  return join(runDir, 'intake', `${rolloutFileStem(rollout)}.json`)
}

export function intakeShadowRolloutFile(
  input: IntakeShadowRolloutFileInput,
): IntakeShadowRolloutFileResult {
  const run = readJsonFile<ShadowLearningRun>(
    join(input.run_dir, 'shadow-learning-run.json'),
  )
  const rollout = readJsonFile<LeviathanRolloutBundle>(input.input_path)
  validateTrainableIntakeRootCause(input, rollout)

  const fileName = rolloutFileName(rollout, input.input_path)
  const rawDir = resolveRunPath(
    input.run_dir,
    run.artifacts.raw_rollouts_dir,
    join('rollouts', 'raw'),
  )
  const rawPath = join(rawDir, fileName)
  writeJsonFile(rawPath, rollout)

  let annotatedPath: string | null = null
  if (shouldAnnotate(input)) {
    const split = input.split as ShadowRolloutIntakeSplit
    const annotatedDir = resolveRunPath(
      input.run_dir,
      annotatedDirForSplit(run, split),
      join('rollouts', 'annotated', split),
    )
    annotatedPath = join(annotatedDir, fileName)
    annotateRolloutFile({
      input_path: rawPath,
      output_path: annotatedPath,
      split: rolloutSchemaSplit(split),
      taxonomy: input.taxonomy ?? [],
      root_cause_summary: input.root_cause_summary,
      final_outcome: input.final_outcome,
      resolved_label: input.resolved_label,
      test_commands: input.test_commands,
      test_outputs: input.test_outputs,
      exit_codes: input.exit_codes,
      changed_files: input.changed_files,
      diff: input.diff,
      export_allowed: input.export_allowed,
      contains_private_code: input.contains_private_code,
    })
  }

  const refreshedStatus = writeShadowLearningRunStatusFile({
    run_dir: input.run_dir,
    output_path: statusPath(input.run_dir),
  }).status

  return {
    report: {
      schema_version: SHADOW_ROLLOUT_INTAKE_SCHEMA_VERSION,
      run_id: run.run_id,
      source_path: input.input_path,
      raw_path: rawPath,
      annotated_path: annotatedPath,
      split: input.split ?? null,
      taxonomy: input.taxonomy ?? [],
      provider_model_id: run.provider_model_id,
      provider_model_update: 'none',
      status_path: statusPath(input.run_dir),
      status: refreshedStatus,
    },
  }
}

export function writeShadowRolloutIntakeReportFile(
  input: WriteShadowRolloutIntakeReportInput,
): WriteShadowRolloutIntakeReportResult {
  const result = intakeShadowRolloutFile(input)
  const outputPath = input.output_path
    ? input.output_path
    : defaultReportPath(input.run_dir, readJsonFile(input.input_path))
  writeJsonFile(outputPath, result.report)
  return {
    ...result,
    output_path: outputPath,
  }
}
