import { readdir, readFile, stat } from 'fs/promises'
import { basename, join, resolve } from 'path'
import { parse as parseYaml } from 'yaml'
import { AwmpModeSchema } from './schemas.js'
import type { AwmpModePackage } from './types.js'

export type ModeSearchHit = {
  modePackage: AwmpModePackage
  score: number
  reasons: string[]
}

export async function loadModePackage(
  modeDir: string,
): Promise<AwmpModePackage> {
  const root = resolve(modeDir)
  const modeYamlPath = join(root, 'mode.yaml')
  const modeYaml = await readFile(modeYamlPath, 'utf8')
  const parsed = AwmpModeSchema.safeParse(parseYaml(modeYaml))

  if (!parsed.success) {
    throw new Error(
      `Invalid AWMP mode at ${modeYamlPath}: ${parsed.error.message}`,
    )
  }

  const skillPath = join(root, 'SKILL.md')
  let skillText: string | undefined
  try {
    skillText = await readFile(skillPath, 'utf8')
  } catch {
    skillText = undefined
  }

  return {
    mode: parsed.data,
    root,
    skillPath: skillText === undefined ? undefined : skillPath,
    skillText,
  }
}

export async function discoverModePackages(
  modeRoots: string[],
): Promise<AwmpModePackage[]> {
  const packages: AwmpModePackage[] = []
  const seen = new Set<string>()

  for (const modeRoot of modeRoots) {
    const root = resolve(modeRoot)
    let entries: Array<{ name: string; isDirectory(): boolean }>
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const candidate = join(root, entry.name)
      const modeYaml = join(candidate, 'mode.yaml')
      try {
        const modeYamlStat = await stat(modeYaml)
        if (!modeYamlStat.isFile()) continue
      } catch {
        continue
      }

      const modePackage = await loadModePackage(candidate)
      if (seen.has(modePackage.mode.id)) continue
      seen.add(modePackage.mode.id)
      packages.push(modePackage)
    }
  }

  return packages.sort((a, b) => a.mode.id.localeCompare(b.mode.id))
}

export function findModeById(
  modes: AwmpModePackage[],
  modeId: string,
): AwmpModePackage | undefined {
  return modes.find(modePackage => modePackage.mode.id === modeId)
}

export function searchModes(
  query: string,
  modes: AwmpModePackage[],
): ModeSearchHit[] {
  const normalizedQuery = normalize(query)
  if (!normalizedQuery) return []

  return modes
    .map(modePackage => {
      const { mode } = modePackage
      let score = 0
      const reasons: string[] = []

      score += scoreText(normalizedQuery, mode.id, 4, reasons, 'id')
      score += scoreText(normalizedQuery, mode.name, 5, reasons, 'name')
      score += scoreText(
        normalizedQuery,
        mode.description,
        4,
        reasons,
        'description',
      )

      for (const intent of mode.activation.intents ?? []) {
        score += scoreText(normalizedQuery, intent, 6, reasons, 'intent')
      }
      for (const example of mode.activation.examples ?? []) {
        score += scoreText(normalizedQuery, example, 3, reasons, 'example')
      }
      for (const antiExample of mode.activation.antiExamples ?? []) {
        const penalty = scoreText(
          normalizedQuery,
          antiExample,
          8,
          [],
          'anti-example',
        )
        if (penalty > 0) {
          score -= penalty
          reasons.push(`anti-example:${shortText(antiExample)}`)
        }
      }

      return { modePackage, score, reasons }
    })
    .filter(hit => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.modePackage.mode.id.localeCompare(b.modePackage.mode.id))
}

export function summarizeModes(modes: AwmpModePackage[]): string {
  if (modes.length === 0) return 'No AWMP modes discovered.'
  return modes
    .map(modePackage => {
      const { mode } = modePackage
      const artifactTypes =
        mode.outputs.artifacts?.map(artifact => artifact.type).join(', ') ??
        'none'
      return [
        `- ${mode.id} (${mode.name})`,
        `  version: ${mode.version}`,
        `  root: ${modePackage.root}`,
        `  outputs: ${artifactTypes}`,
        `  validators: ${mode.validators?.length ?? 0}`,
      ].join('\n')
    })
    .join('\n')
}

function scoreText(
  normalizedQuery: string,
  value: string,
  weight: number,
  reasons: string[],
  label: string,
): number {
  const normalizedValue = normalize(value)
  if (!normalizedValue) return 0
  if (
    normalizedQuery.includes(normalizedValue) ||
    normalizedValue.includes(normalizedQuery)
  ) {
    reasons.push(`${label}:${shortText(value)}`)
    return weight
  }

  const queryTerms = splitTerms(normalizedQuery)
  const valueTerms = splitTerms(normalizedValue)
  const overlap = queryTerms.filter(term =>
    valueTerms.some(valueTerm => valueTerm.includes(term) || term.includes(valueTerm)),
  )
  if (overlap.length === 0) return 0
  reasons.push(`${label}:${shortText(value)}`)
  return Math.min(weight, overlap.length)
}

function splitTerms(value: string): string[] {
  const terms = value
    .split(/[\s,.;:!?，。；：！？、/\\()[\]{}"'`|]+/)
    .map(term => term.trim())
    .filter(term => term.length >= 2)

  const cjkChunks = value.match(/[\p{Script=Han}]{2,}/gu) ?? []
  for (const chunk of cjkChunks) {
    terms.push(chunk)
    for (let index = 0; index < chunk.length - 1; index += 1) {
      terms.push(chunk.slice(index, index + 2))
    }
  }

  return [...new Set(terms)]
}

function normalize(value: string): string {
  return value.toLowerCase().trim()
}

function shortText(value: string): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  if (clean.length <= 40) return clean
  return `${clean.slice(0, 37)}...`
}

export function modeRootLabel(modeRoot: string): string {
  return basename(resolve(modeRoot)) || resolve(modeRoot)
}
