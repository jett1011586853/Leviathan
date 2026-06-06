import {
  existsSync,
  mkdirSync,
  readFileSync,
} from 'node:fs'
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path'

import type { LeviathanRolloutBundle } from './rolloutSchema.js'
import {
  readShadowLearningRunStatusFromFiles,
  writeShadowLearningRunStatusFile,
  type ShadowLearningRunStatusSnapshot,
} from './shadowLearningRunStatusFiles.js'
import { redactText } from './redaction.js'
import {
  jsonParse,
  jsonStringify,
  writeFileSync_DEPRECATED,
} from '../utils/slowOperations.js'

export const ROOT_CAUSE_REPAIR_MANIFEST_SCHEMA_VERSION =
  'leviathan.root_cause_repair_manifest.v1' as const

export const ROOT_CAUSE_REPAIR_REPORT_SCHEMA_VERSION =
  'leviathan.root_cause_repair_report.v1' as const

export type RootCauseRepairManifestEntry = {
  path?: string
  file?: string
  rollout_path?: string
  root_cause_summary?: string
  evidence_required?: string
}

export type RootCauseRepairManifest = {
  schema_version?: typeof ROOT_CAUSE_REPAIR_MANIFEST_SCHEMA_VERSION
  entries?: RootCauseRepairManifestEntry[]
}

export type ShadowRootCauseRepairInput = {
  run_dir: string
  manifest_path: string
}

export type WriteShadowRootCauseRepairReportInput =
  ShadowRootCauseRepairInput & {
    output_path?: string
  }

export type RootCauseRepairReportEntry = {
  path: string
  reason: string
}

export type ShadowRootCauseRepairReport = {
  schema_version: typeof ROOT_CAUSE_REPAIR_REPORT_SCHEMA_VERSION
  manifest_path: string
  repaired_count: number
  skipped_count: number
  blocked_count: number
  repaired_files: string[]
  skipped_entries: RootCauseRepairReportEntry[]
  blocked_entries: RootCauseRepairReportEntry[]
  status_path: string
  status: ShadowLearningRunStatusSnapshot
}

export type WriteShadowRootCauseRepairReportResult = {
  output_path: string
  report: ShadowRootCauseRepairReport
}

export type WriteShadowRootCauseTemplateFileInput = {
  run_dir: string
  output_path: string
}

export type ShadowRootCauseTemplate = {
  schema_version: typeof ROOT_CAUSE_REPAIR_MANIFEST_SCHEMA_VERSION
  run_id: string
  entries: Required<
    Pick<RootCauseRepairManifestEntry, 'path' | 'root_cause_summary' | 'evidence_required'>
  >[]
}

export type WriteShadowRootCauseTemplateFileResult = {
  output_path: string
  template: ShadowRootCauseTemplate
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

function manifestEntries(value: unknown): RootCauseRepairManifestEntry[] {
  if (Array.isArray(value)) return value as RootCauseRepairManifestEntry[]
  const manifest = value as RootCauseRepairManifest
  return Array.isArray(manifest.entries) ? manifest.entries : []
}

function entryPath(entry: RootCauseRepairManifestEntry): string {
  return entry.path ?? entry.file ?? entry.rollout_path ?? ''
}

function resolveEntryPath(runDir: string, path: string): {
  absolutePath: string
  relativePath: string
  insideRunDir: boolean
} {
  const runRoot = resolve(runDir)
  const absolutePath = isAbsolute(path) ? resolve(path) : resolve(runRoot, path)
  const relativePath = relative(runRoot, absolutePath).replace(/\\/g, '/')
  return {
    absolutePath,
    relativePath,
    insideRunDir:
      relativePath === '' ||
      (!relativePath.startsWith('..') && !isAbsolute(relativePath)),
  }
}

function isTrainableAnnotatedRollout(bundle: LeviathanRolloutBundle): boolean {
  return (
    (bundle.run.split === 'train' || bundle.run.split === 'dev') &&
    bundle.failure.taxonomy.some(value => value.trim().length > 0)
  )
}

function statusPath(runDir: string): string {
  return join(runDir, 'shadow-status.json')
}

function defaultReportPath(runDir: string): string {
  return join(runDir, 'root-cause-repair.json')
}

export function writeShadowRootCauseTemplateFile(
  input: WriteShadowRootCauseTemplateFileInput,
): WriteShadowRootCauseTemplateFileResult {
  const status = readShadowLearningRunStatusFromFiles({
    run_dir: input.run_dir,
  })
  const missingFiles = [
    ...status.annotation_quality.missing_root_cause_files.train,
    ...status.annotation_quality.missing_root_cause_files.dev,
  ]
  const template: ShadowRootCauseTemplate = {
    schema_version: ROOT_CAUSE_REPAIR_MANIFEST_SCHEMA_VERSION,
    run_id: status.run_id,
    entries: missingFiles.map(path => ({
      path,
      root_cause_summary: '',
      evidence_required:
        'Fill from transcript, tool, diff, and evaluation evidence; do not fabricate.',
    })),
  }
  writeJsonFile(input.output_path, template)
  return {
    output_path: input.output_path,
    template,
  }
}

export function writeShadowRootCauseRepairReportFile(
  input: WriteShadowRootCauseRepairReportInput,
): WriteShadowRootCauseRepairReportResult {
  const rawManifest = readJsonFile<unknown>(input.manifest_path)
  const repairedFiles: string[] = []
  const skippedEntries: RootCauseRepairReportEntry[] = []
  const blockedEntries: RootCauseRepairReportEntry[] = []

  for (const entry of manifestEntries(rawManifest)) {
    const requestedPath = entryPath(entry)
    if (requestedPath.trim().length === 0) {
      blockedEntries.push({ path: '', reason: 'path.required' })
      continue
    }

    const rootCauseSummary = entry.root_cause_summary ?? ''
    const resolvedPath = resolveEntryPath(input.run_dir, requestedPath)
    if (!resolvedPath.insideRunDir) {
      blockedEntries.push({
        path: requestedPath,
        reason: 'path.outside_run_dir',
      })
      continue
    }

    if (rootCauseSummary.trim().length === 0) {
      blockedEntries.push({
        path: resolvedPath.relativePath,
        reason: 'root_cause_summary.required',
      })
      continue
    }

    if (!existsSync(resolvedPath.absolutePath)) {
      blockedEntries.push({
        path: resolvedPath.relativePath,
        reason: 'file.missing',
      })
      continue
    }

    const bundle = readJsonFile<LeviathanRolloutBundle>(
      resolvedPath.absolutePath,
    )
    if (!isTrainableAnnotatedRollout(bundle)) {
      blockedEntries.push({
        path: resolvedPath.relativePath,
        reason: 'rollout.not_trainable_annotation',
      })
      continue
    }

    if (bundle.failure.root_cause_summary.trim().length > 0) {
      skippedEntries.push({
        path: resolvedPath.relativePath,
        reason: 'root_cause_summary.already_present',
      })
      continue
    }

    bundle.failure.root_cause_summary = redactText(rootCauseSummary)
    writeJsonFile(resolvedPath.absolutePath, bundle)
    repairedFiles.push(resolvedPath.relativePath)
  }

  const refreshedStatus = writeShadowLearningRunStatusFile({
    run_dir: input.run_dir,
    output_path: statusPath(input.run_dir),
  }).status
  const report: ShadowRootCauseRepairReport = {
    schema_version: ROOT_CAUSE_REPAIR_REPORT_SCHEMA_VERSION,
    manifest_path: input.manifest_path,
    repaired_count: repairedFiles.length,
    skipped_count: skippedEntries.length,
    blocked_count: blockedEntries.length,
    repaired_files: repairedFiles,
    skipped_entries: skippedEntries,
    blocked_entries: blockedEntries,
    status_path: statusPath(input.run_dir),
    status: refreshedStatus,
  }
  const outputPath = input.output_path ?? defaultReportPath(input.run_dir)
  writeJsonFile(outputPath, report)

  return {
    output_path: outputPath,
    report,
  }
}
