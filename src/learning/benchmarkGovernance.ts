export type BenchmarkSource =
  | 'internal'
  | 'secret'
  | 'swe-gym'
  | 'swe-bench-lite'
  | 'swe-bench-verified'
  | 'swe-bench-pro'
  | 'swe-bench-live'
  | 'public-other'

export type BenchmarkSplit = 'train' | 'dev' | 'test' | 'secret'

export type BenchmarkTaskRecord = {
  id: string
  source: BenchmarkSource
  split: BenchmarkSplit
  repo: string
  base_commit: string
  issue_id: string
  benchmark_instance_id: string
  problem_statement_hash: string
  normalized_diff_hash: string
  public_visibility: 'internal' | 'public' | 'private'
  allow_policy_training: boolean
  allow_global_memory: boolean
}

export type BenchmarkGovernanceViolation = {
  type:
    | 'final_eval_training_leak'
    | 'final_eval_memory_leak'
    | 'split_identity_overlap'
    | 'split_patch_overlap'
  task_ids: string[]
  detail: string
}

export type BenchmarkGovernanceResult = {
  isolated: boolean
  violations: BenchmarkGovernanceViolation[]
}

export type BenchmarkSourceSummary = {
  internal: number
  public: number
  private_secret: number
  by_source: Record<string, number>
}

function isFinalEvaluation(record: BenchmarkTaskRecord): boolean {
  return record.split === 'test' || record.split === 'secret'
}

function taskIdentity(record: BenchmarkTaskRecord): string {
  return [
    record.repo,
    record.base_commit,
    record.issue_id,
    record.benchmark_instance_id,
  ].join('|')
}

function addGroupedViolation(
  violations: BenchmarkGovernanceViolation[],
  type: BenchmarkGovernanceViolation['type'],
  records: BenchmarkTaskRecord[],
  detail: string,
): void {
  if (records.length < 2) return
  const splits = new Set(records.map(record => record.split))
  if (splits.size < 2) return
  violations.push({
    type,
    task_ids: records.map(record => record.id),
    detail,
  })
}

function groupedBy(
  records: BenchmarkTaskRecord[],
  keyFn: (record: BenchmarkTaskRecord) => string,
): Map<string, BenchmarkTaskRecord[]> {
  const groups = new Map<string, BenchmarkTaskRecord[]>()
  for (const record of records) {
    const key = keyFn(record)
    if (!key.trim()) continue
    const group = groups.get(key) ?? []
    group.push(record)
    groups.set(key, group)
  }
  return groups
}

export function validateBenchmarkSplits(
  records: BenchmarkTaskRecord[],
): BenchmarkGovernanceResult {
  const violations: BenchmarkGovernanceViolation[] = []

  for (const record of records) {
    if (!isFinalEvaluation(record)) continue
    if (record.allow_policy_training) {
      violations.push({
        type: 'final_eval_training_leak',
        task_ids: [record.id],
        detail: 'Final evaluation records cannot enter policy training.',
      })
    }
    if (record.allow_global_memory) {
      violations.push({
        type: 'final_eval_memory_leak',
        task_ids: [record.id],
        detail: 'Final evaluation records cannot write to global memory.',
      })
    }
  }

  for (const group of groupedBy(records, taskIdentity).values()) {
    addGroupedViolation(
      violations,
      'split_identity_overlap',
      group,
      'The same repo/base_commit/issue/benchmark/problem statement crosses split boundaries.',
    )
  }

  for (const group of groupedBy(
    records,
    record => record.normalized_diff_hash,
  ).values()) {
    addGroupedViolation(
      violations,
      'split_patch_overlap',
      group,
      'The same normalized patch crosses split boundaries.',
    )
  }

  return {
    isolated: violations.length === 0,
    violations,
  }
}

export function summarizeBenchmarkSources(
  records: BenchmarkTaskRecord[],
): BenchmarkSourceSummary {
  const summary: BenchmarkSourceSummary = {
    internal: 0,
    public: 0,
    private_secret: 0,
    by_source: {},
  }

  for (const record of records) {
    if (record.source === 'secret' || record.split === 'secret') {
      summary.private_secret += 1
    } else if (record.public_visibility === 'public') {
      summary.public += 1
    } else {
      summary.internal += 1
    }
    summary.by_source[record.source] = (summary.by_source[record.source] ?? 0) + 1
  }

  return summary
}
