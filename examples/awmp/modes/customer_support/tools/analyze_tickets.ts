import { readFile } from 'fs/promises'
import { join } from 'path'

type AwmpTask = {
  inputs?: {
    dateRange?: { from?: string; to?: string }
    ticketSample?: Array<{ id: string; category: string; severity?: string }>
    audience?: string
  }
}

const runDir = process.env.AWMP_RUN_DIR ?? ''
const task = await readTask(runDir)
const tickets = task.inputs?.ticketSample ?? defaultTickets()
const counts = countBy(tickets.map(ticket => ticket.category))
const topIssues = [...counts.entries()]
  .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
  .slice(0, 5)
  .map(([label, count]) => ({
    label,
    count,
    severity: inferSeverity(label, count),
  }))

const report = {
  modeId: 'com.leviathan.customer_support',
  summary: `Analyzed ${tickets.length} support tickets for ${task.inputs?.audience ?? 'management'} review.`,
  dateRange: task.inputs?.dateRange ?? { from: 'sample-start', to: 'sample-end' },
  topIssues,
  approvalRequired: tickets
    .filter(ticket => ticket.category === 'refund' || ticket.severity === 'high')
    .slice(0, 3)
    .map(ticket => ({
      caseId: ticket.id,
      reason: 'Potential refund or high-severity support action requires review.',
      permission: 'refund:create',
    })),
  source: {
    kind: 'deterministic_fixture',
    ticketCount: tickets.length,
  },
}

console.log(
  JSON.stringify({
    artifact: {
      type: 'support.analysis.report',
      fileName: 'support_analysis_report.json',
      content: report,
    },
  }),
)

async function readTask(runDir: string): Promise<AwmpTask> {
  if (!runDir) return {}
  try {
    return JSON.parse(await readFile(join(runDir, 'task.json'), 'utf8')) as AwmpTask
  } catch {
    return {}
  }
}

function countBy(values: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return counts
}

function inferSeverity(label: string, count: number): 'low' | 'medium' | 'high' {
  if (label === 'refund' || count >= 3) return 'high'
  if (label === 'billing' || count >= 2) return 'medium'
  return 'low'
}

function defaultTickets(): Array<{ id: string; category: string; severity?: string }> {
  return [
    { id: 'T-1001', category: 'refund', severity: 'high' },
    { id: 'T-1002', category: 'billing', severity: 'medium' },
    { id: 'T-1003', category: 'refund', severity: 'high' },
    { id: 'T-1004', category: 'delivery', severity: 'medium' },
    { id: 'T-1005', category: 'billing', severity: 'medium' },
  ]
}
