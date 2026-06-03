import { describe, expect, test } from 'bun:test'

import {
  summarizeBenchmarkSources,
  validateBenchmarkSplits,
  type BenchmarkTaskRecord,
} from '../learning/benchmarkGovernance.js'

function task(
  id: string,
  overrides: Partial<BenchmarkTaskRecord> = {},
): BenchmarkTaskRecord {
  return {
    id,
    source: 'internal',
    split: 'train',
    repo: 'leviathan',
    base_commit: `commit_${id}`,
    issue_id: `issue_${id}`,
    benchmark_instance_id: '',
    problem_statement_hash: `problem_${id}`,
    normalized_diff_hash: `diff_${id}`,
    public_visibility: 'private',
    allow_policy_training: true,
    allow_global_memory: true,
    ...overrides,
  }
}

describe('Leviathan benchmark split governance', () => {
  test('accepts isolated training, development, and final evaluation splits', () => {
    const result = validateBenchmarkSplits([
      task('train_1'),
      task('dev_1', {
        split: 'dev',
        allow_policy_training: false,
      }),
      task('secret_1', {
        split: 'secret',
        source: 'secret',
        public_visibility: 'private',
        allow_policy_training: false,
        allow_global_memory: false,
      }),
      task('public_eval_1', {
        split: 'test',
        source: 'swe-bench-lite',
        public_visibility: 'public',
        allow_policy_training: false,
        allow_global_memory: false,
      }),
    ])

    expect(result.isolated).toBe(true)
    expect(result.violations).toEqual([])
  })

  test('rejects final evaluation records that can enter training or global memory', () => {
    const result = validateBenchmarkSplits([
      task('eval_leak', {
        split: 'test',
        source: 'swe-bench-verified',
        public_visibility: 'public',
        allow_policy_training: true,
        allow_global_memory: true,
      }),
    ])

    expect(result.isolated).toBe(false)
    expect(result.violations).toEqual([
      {
        type: 'final_eval_training_leak',
        task_ids: ['eval_leak'],
        detail: 'Final evaluation records cannot enter policy training.',
      },
      {
        type: 'final_eval_memory_leak',
        task_ids: ['eval_leak'],
        detail: 'Final evaluation records cannot write to global memory.',
      },
    ])
  })

  test('rejects train/dev/final overlap by task identity and patch hash', () => {
    const result = validateBenchmarkSplits([
      task('train_overlap', {
        split: 'train',
        repo: 'repo-a',
        base_commit: 'abc',
        issue_id: '42',
        benchmark_instance_id: 'swe-42',
        normalized_diff_hash: 'same_patch',
      }),
      task('test_overlap', {
        split: 'test',
        repo: 'repo-a',
        base_commit: 'abc',
        issue_id: '42',
        benchmark_instance_id: 'swe-42',
        normalized_diff_hash: 'same_patch',
        allow_policy_training: false,
        allow_global_memory: false,
      }),
      task('dev_patch_overlap', {
        split: 'dev',
        repo: 'repo-b',
        base_commit: 'def',
        issue_id: '43',
        benchmark_instance_id: '',
        normalized_diff_hash: 'same_patch',
        allow_policy_training: false,
      }),
    ])

    expect(result.isolated).toBe(false)
    expect(result.violations.map(violation => violation.type)).toEqual([
      'split_identity_overlap',
      'split_patch_overlap',
    ])
    expect(result.violations[0].task_ids).toEqual([
      'train_overlap',
      'test_overlap',
    ])
    expect(result.violations[1].task_ids).toEqual([
      'train_overlap',
      'test_overlap',
      'dev_patch_overlap',
    ])
  })

  test('summarizes result reporting by internal public and private-secret sources', () => {
    const summary = summarizeBenchmarkSources([
      task('internal_1'),
      task('public_1', {
        split: 'test',
        source: 'swe-bench-live',
        public_visibility: 'public',
        allow_policy_training: false,
        allow_global_memory: false,
      }),
      task('secret_1', {
        split: 'secret',
        source: 'secret',
        public_visibility: 'private',
        allow_policy_training: false,
        allow_global_memory: false,
      }),
    ])

    expect(summary).toEqual({
      internal: 1,
      public: 1,
      private_secret: 1,
      by_source: {
        internal: 1,
        'swe-bench-live': 1,
        secret: 1,
      },
    })
  })
})
