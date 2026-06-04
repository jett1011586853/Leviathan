import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'

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

export const SHADOW_EVIDENCE_INTAKE_SCHEMA_VERSION =
  'leviathan.shadow_evidence_intake.v1' as const

export const SHADOW_EVIDENCE_KINDS = [
  'replay-results',
  'failure-taxonomy',
  'benchmark-splits',
  'polar-spike-observations',
  'reward-design',
  'rollback-incident-plan',
] as const

export type ShadowEvidenceKind = (typeof SHADOW_EVIDENCE_KINDS)[number]

export type ShadowEvidenceIntakeReport = {
  schema_version: typeof SHADOW_EVIDENCE_INTAKE_SCHEMA_VERSION
  run_id: string
  source_path: string
  evidence_kind: ShadowEvidenceKind
  evidence_path: string
  provider_model_id: string
  provider_model_update: 'none'
  status_path: string
  status: ShadowLearningRunStatusSnapshot
}

export type IntakeShadowEvidenceFileInput = {
  run_dir: string
  input_path: string
  kind: ShadowEvidenceKind
}

export type WriteShadowEvidenceIntakeReportInput =
  IntakeShadowEvidenceFileInput & {
    output_path?: string
  }

export type IntakeShadowEvidenceFileResult = {
  report: ShadowEvidenceIntakeReport
}

export type WriteShadowEvidenceIntakeReportResult =
  IntakeShadowEvidenceFileResult & {
    output_path: string
  }

export function isShadowEvidenceKind(
  value: string,
): value is ShadowEvidenceKind {
  return (SHADOW_EVIDENCE_KINDS as readonly string[]).includes(value)
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

function evidenceFilename(kind: ShadowEvidenceKind): string {
  return `${kind}.json`
}

function statusPath(runDir: string): string {
  return join(runDir, 'shadow-status.json')
}

function defaultReportPath(runDir: string, kind: ShadowEvidenceKind): string {
  return join(runDir, 'intake', `evidence-${kind}.json`)
}

export function intakeShadowEvidenceFile(
  input: IntakeShadowEvidenceFileInput,
): IntakeShadowEvidenceFileResult {
  const run = readJsonFile<ShadowLearningRun>(
    join(input.run_dir, 'shadow-learning-run.json'),
  )
  const evidenceDir = resolveRunPath(
    input.run_dir,
    run.artifacts.evidence_dir,
    'evidence',
  )
  const evidencePath = join(evidenceDir, evidenceFilename(input.kind))
  writeJsonFile(evidencePath, readJsonFile(input.input_path))

  const refreshedStatus = writeShadowLearningRunStatusFile({
    run_dir: input.run_dir,
    output_path: statusPath(input.run_dir),
  }).status

  return {
    report: {
      schema_version: SHADOW_EVIDENCE_INTAKE_SCHEMA_VERSION,
      run_id: run.run_id,
      source_path: input.input_path,
      evidence_kind: input.kind,
      evidence_path: evidencePath,
      provider_model_id: run.provider_model_id,
      provider_model_update: 'none',
      status_path: statusPath(input.run_dir),
      status: refreshedStatus,
    },
  }
}

export function writeShadowEvidenceIntakeReportFile(
  input: WriteShadowEvidenceIntakeReportInput,
): WriteShadowEvidenceIntakeReportResult {
  const result = intakeShadowEvidenceFile(input)
  const outputPath =
    input.output_path ?? defaultReportPath(input.run_dir, input.kind)
  writeJsonFile(outputPath, result.report)
  return {
    ...result,
    output_path: outputPath,
  }
}
