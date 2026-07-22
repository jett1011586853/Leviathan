import { readFile } from 'fs/promises'
import { join } from 'path'

type Artifact = {
  id: string
  type: string
  uri: string
}

const runDir = process.env.AWMP_RUN_DIR ?? ''
const artifacts = await readArtifactIndex(runDir)
const supportReportArtifact = artifacts.find(
  artifact => artifact.type === 'support.analysis.report',
)
const supportReport = supportReportArtifact
  ? await readJson(supportReportArtifact.uri)
  : undefined
const topIssues = Array.isArray((supportReport as { topIssues?: unknown })?.topIssues)
  ? ((supportReport as { topIssues: Array<{ label?: string; count?: number }> }).topIssues)
  : []
const slides = [
  {
    title: 'Executive Summary',
    bullets: [
      supportReportArtifact
        ? 'Built from support.analysis.report artifact evidence.'
        : 'Built from deterministic fallback because no upstream report was found.',
    ],
  },
  {
    title: 'Top Support Issues',
    bullets:
      topIssues.length === 0
        ? ['No upstream issue list was available.']
        : topIssues.map(issue => `${issue.label ?? 'unknown'}: ${issue.count ?? 0}`),
  },
  {
    title: 'Approval-Sensitive Actions',
    bullets: ['Refund actions remain approval-gated by AWMP permissions.'],
  },
]
const outline = {
  modeId: 'com.leviathan.ppt',
  sourceArtifact: supportReportArtifact?.id,
  slides,
}
const deck = {
  modeId: 'com.leviathan.ppt',
  format: 'pptx-placeholder',
  outlineArtifact: 'presentation_outline.json',
  slideCount: slides.length,
  note: 'This is a deterministic deck artifact record for AWMP runtime validation.',
}

console.log(
  JSON.stringify({
    artifacts: [
      {
        type: 'presentation.outline',
        fileName: 'presentation_outline.json',
        content: outline,
      },
      {
        type: 'presentation.pptx',
        fileName: 'management_presentation_pptx_record.json',
        content: deck,
      },
    ],
  }),
)

async function readArtifactIndex(runDir: string): Promise<Artifact[]> {
  if (!runDir) return []
  try {
    return JSON.parse(
      await readFile(join(runDir, 'artifacts', 'index.json'), 'utf8'),
    ) as Artifact[]
  } catch {
    return []
  }
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown
}
