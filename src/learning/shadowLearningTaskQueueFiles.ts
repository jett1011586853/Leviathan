import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { FAILURE_TAXONOMY } from './failureTaxonomy.js'
import type { ShadowLearningRun } from './shadowLearningRunFiles.js'
import {
  jsonParse,
  jsonStringify,
  writeFileSync_DEPRECATED,
} from '../utils/slowOperations.js'

export const SHADOW_TASK_QUEUE_SCHEMA_VERSION =
  'leviathan.shadow_task_queue.v1' as const

export type ShadowTaskQueueSplit = 'train' | 'dev' | 'held_out'

export type ShadowRolloutTaskStatus = 'pending'

export type ShadowRolloutTask = {
  task_id: string
  status: ShadowRolloutTaskStatus
  split: ShadowTaskQueueSplit
  source: 'internal'
  taxonomy_hint: string
  target_asset: string
  collection_instruction: string
  export_path: string
  export_command: string
  intake_command: string
}

export type ShadowLearningTaskQueue = {
  schema_version: typeof SHADOW_TASK_QUEUE_SCHEMA_VERSION
  run_id: string
  provider_model_id: string
  provider_model_update: 'none'
  target_rollout_count: number
  split_counts: Record<ShadowTaskQueueSplit, number>
  coverage: {
    taxonomy_classes: string[]
    taxonomy_targets: Record<string, number>
  }
  tasks: ShadowRolloutTask[]
  next_actions: string[]
}

export type WriteShadowLearningTaskQueueFileInput = {
  run_dir: string
  output_path?: string
}

export type WriteShadowLearningTaskQueueFileResult = {
  output_path: string
  queue: ShadowLearningTaskQueue
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

function taskId(runId: string, split: ShadowTaskQueueSplit, index: number): string {
  return `${runId}_${split}_${String(index + 1).padStart(3, '0')}`
}

function taxonomyHint(index: number): string {
  const entry = FAILURE_TAXONOMY[index % FAILURE_TAXONOMY.length]
  const signal = entry.signals[index % entry.signals.length] ?? 'general'
  return `${entry.code}.${signal}`
}

function targetAsset(index: number): string {
  const entry = FAILURE_TAXONOMY[index % FAILURE_TAXONOMY.length]
  return entry.target_assets[index % entry.target_assets.length] ?? 'harness'
}

function instructionFor(index: number): string {
  const entry = FAILURE_TAXONOMY[index % FAILURE_TAXONOMY.length]
  const signal = entry.signals[index % entry.signals.length] ?? 'general'
  return [
    `Run a real Leviathan coding-agent task that can expose ${entry.label}.`,
    `Prefer a task where the observable failure signal is ${signal}.`,
    'Use the connected provider model normally; do not fabricate transcript, tool, or evaluation data.',
    'Use only tools that are actually available in the current Leviathan session. Do not call Glob or Read unless those tools are explicitly available; if they are absent, use Bash with repo-relative commands such as rg, find, ls, sed, or Get-Content equivalents.',
    'Do not treat $WORKDIR as a verified shell variable. Confirm cwd with pwd or use repo-relative paths; when a path variable is truly available, use balanced quoting such as "$WORKDIR".',
    'After the task, export the rollout and intake it with the provided command.',
  ].join(' ')
}

function splitSequence(run: ShadowLearningRun): ShadowTaskQueueSplit[] {
  return [
    ...Array.from({ length: run.split_plan.train }, () => 'train' as const),
    ...Array.from({ length: run.split_plan.dev }, () => 'dev' as const),
    ...Array.from({ length: run.split_plan.held_out }, () => 'held_out' as const),
  ]
}

function exportPath(run: ShadowLearningRun, task_id: string): string {
  return join(run.artifacts.output_dir, 'rollouts', 'exported', `${task_id}.json`)
}

function intakeReportPath(run: ShadowLearningRun, task_id: string): string {
  return join(run.artifacts.output_dir, 'intake', `${task_id}.json`)
}

function rolloutExportSplit(split: ShadowTaskQueueSplit): 'train' | 'dev' | 'test' {
  return split === 'held_out' ? 'test' : split
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

function buildTask(
  run: ShadowLearningRun,
  split: ShadowTaskQueueSplit,
  index: number,
): ShadowRolloutTask {
  const id = taskId(run.run_id, split, index)
  const hint = taxonomyHint(index)
  const exported = exportPath(run, id)
  const exportSplit = rolloutExportSplit(split)
  return {
    task_id: id,
    status: 'pending',
    split,
    source: 'internal',
    taxonomy_hint: hint,
    target_asset: targetAsset(index),
    collection_instruction: instructionFor(index),
    export_path: exported,
    export_command:
      `/export --rollout ${shellQuote(exported)}` +
      ` --run-id ${run.run_id}` +
      ` --task-id ${id}` +
      ` --split ${exportSplit}` +
      ` --harness-version git:${run.git_commit}` +
      ` --heuristic-bundle hb:unversioned` +
      ` --policy-version ${run.provider_model_id}` +
      ` --repo leviathan` +
      ` --base-commit ${run.git_commit}` +
      ` --cwd-alias ${shellQuote(run.cwd_alias)}`,
    intake_command:
      `/learning intake-shadow-rollout --run-dir ${shellQuote(run.artifacts.output_dir)}` +
      ` --input ${shellQuote(exported)}` +
      ` --out ${shellQuote(intakeReportPath(run, id))}` +
      ` --split ${split}` +
      ` --taxonomy ${hint}`,
  }
}

function taxonomyTargets(tasks: ShadowRolloutTask[]): Record<string, number> {
  const targets: Record<string, number> = {}
  for (const task of tasks) {
    const className = task.taxonomy_hint.split('.')[0] ?? 'unknown'
    targets[className] = (targets[className] ?? 0) + 1
  }
  return targets
}

export function createShadowLearningTaskQueue(
  run: ShadowLearningRun,
): ShadowLearningTaskQueue {
  const tasks = splitSequence(run).map((split, index) =>
    buildTask(run, split, index),
  )
  return {
    schema_version: SHADOW_TASK_QUEUE_SCHEMA_VERSION,
    run_id: run.run_id,
    provider_model_id: run.provider_model_id,
    provider_model_update: 'none',
    target_rollout_count: run.target_rollout_count,
    split_counts: {
      train: run.split_plan.train,
      dev: run.split_plan.dev,
      held_out: run.split_plan.held_out,
    },
    coverage: {
      taxonomy_classes: FAILURE_TAXONOMY.map(entry => entry.code),
      taxonomy_targets: taxonomyTargets(tasks),
    },
    tasks,
    next_actions: [
      'Run the pending tasks with Leviathan, export each rollout, then intake it with the task intake command.',
      'Keep held_out tasks isolated from training and do not promote any bundle before collect-shadow reports ready.',
      'Refresh /learning status-shadow after every intake batch.',
    ],
  }
}

export function writeShadowLearningTaskQueueFile(
  input: WriteShadowLearningTaskQueueFileInput,
): WriteShadowLearningTaskQueueFileResult {
  const run = readJsonFile<ShadowLearningRun>(
    join(input.run_dir, 'shadow-learning-run.json'),
  )
  const outputPath = input.output_path ?? join(input.run_dir, 'task-queue.json')
  const queue = createShadowLearningTaskQueue(run)
  writeJsonFile(outputPath, queue)
  return {
    output_path: outputPath,
    queue,
  }
}
