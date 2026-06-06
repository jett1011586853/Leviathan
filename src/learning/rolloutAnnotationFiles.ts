import { mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'

import type {
  LeviathanRolloutBundle,
  RolloutFinalOutcome,
} from './rolloutSchema.js'
import { redactText } from './redaction.js'
import {
  jsonParse,
  jsonStringify,
  writeFileSync_DEPRECATED,
} from '../utils/slowOperations.js'

export type AnnotateRolloutFileInput = {
  input_path: string
  output_path: string
  split?: LeviathanRolloutBundle['run']['split']
  taxonomy: string[]
  root_cause_summary?: string
  final_outcome?: RolloutFinalOutcome
  resolved_label?: boolean | null
  test_commands?: string[]
  test_outputs?: string[]
  exit_codes?: number[]
  changed_files?: string[]
  diff?: string
  export_allowed?: boolean
  contains_private_code?: boolean
}

export type AnnotateRolloutFileResult = {
  output_path: string
  rollout: LeviathanRolloutBundle
}

export const TRAINABLE_ROOT_CAUSE_REQUIRED_ERROR =
  'root_cause_summary.required_for_trainable_rollout'

function readRollout(path: string): LeviathanRolloutBundle {
  return jsonParse(readFileSync(path, 'utf8')) as LeviathanRolloutBundle
}

function redactStrings(values: string[] | undefined): string[] | undefined {
  return values?.map(value => redactText(value))
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))]
}

export function assertTrainableRolloutRootCause(input: {
  split: LeviathanRolloutBundle['run']['split']
  taxonomy: string[]
  root_cause_summary: string
}): void {
  const hasTrainableTaxonomy = uniqueNonEmpty(input.taxonomy).length > 0
  const requiresRootCause =
    (input.split === 'train' || input.split === 'dev') && hasTrainableTaxonomy
  if (requiresRootCause && input.root_cause_summary.trim().length === 0) {
    throw new Error(TRAINABLE_ROOT_CAUSE_REQUIRED_ERROR)
  }
}

function writeRollout(path: string, rollout: LeviathanRolloutBundle): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync_DEPRECATED(path, jsonStringify(rollout, null, 2), {
    encoding: 'utf-8',
    flush: true,
  })
}

export function annotateRolloutFile(
  input: AnnotateRolloutFileInput,
): AnnotateRolloutFileResult {
  const source = readRollout(input.input_path)
  const split = input.split ?? source.run.split
  const taxonomy = uniqueNonEmpty(input.taxonomy)
  const rootCauseSummary =
    input.root_cause_summary !== undefined
      ? redactText(input.root_cause_summary)
      : source.failure.root_cause_summary
  assertTrainableRolloutRootCause({
    split,
    taxonomy,
    root_cause_summary: rootCauseSummary,
  })

  const rollout: LeviathanRolloutBundle = {
    ...source,
    run: {
      ...source.run,
      split,
    },
    code_changes: {
      diff:
        input.diff !== undefined
          ? redactText(input.diff)
          : source.code_changes.diff,
      changed_files:
        redactStrings(input.changed_files) ?? source.code_changes.changed_files,
    },
    evaluation: {
      test_commands:
        redactStrings(input.test_commands) ?? source.evaluation.test_commands,
      test_outputs:
        redactStrings(input.test_outputs) ?? source.evaluation.test_outputs,
      exit_codes: input.exit_codes ?? source.evaluation.exit_codes,
      final_outcome: input.final_outcome ?? source.evaluation.final_outcome,
      resolved_label:
        input.resolved_label !== undefined
          ? input.resolved_label
          : source.evaluation.resolved_label,
    },
    failure: {
      taxonomy,
      root_cause_summary: rootCauseSummary,
    },
    security: {
      ...source.security,
      export_allowed:
        input.export_allowed !== undefined
          ? input.export_allowed
          : source.security.export_allowed,
      contains_private_code:
        input.contains_private_code !== undefined
          ? input.contains_private_code
          : source.security.contains_private_code,
    },
  }

  writeRollout(input.output_path, rollout)

  return {
    output_path: input.output_path,
    rollout,
  }
}
