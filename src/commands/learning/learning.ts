import type { LocalJSXCommandOnDone } from '../../types/command.js'
import { launchTrainingRunFromConfigFile } from '../../learning/trainingRunFiles.js'

export type ParsedLearningCommandArgs =
  | {
      action: 'start'
      config_path: string
      output_path: string
      run_id?: string
      created_at?: string
    }
  | {
      action: 'help'
    }

const USAGE =
  'Usage: /learning start --config <launch.json> --out <manifest.json>'

function tokenizeArgs(args: string): string[] {
  const tokens: string[] = []
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g
  let match: RegExpExecArray | null

  while ((match = pattern.exec(args)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? '')
  }

  return tokens
}

function readFlag(tokens: string[], names: string[]): string {
  for (const name of names) {
    const equalsToken = tokens.find(token => token.startsWith(`${name}=`))
    if (equalsToken) return equalsToken.slice(name.length + 1)

    const index = tokens.indexOf(name)
    if (index >= 0 && index + 1 < tokens.length) return tokens[index + 1] ?? ''
  }

  return ''
}

export function parseLearningCommandArgs(
  args: string,
): ParsedLearningCommandArgs {
  const tokens = tokenizeArgs(args.trim())
  if (tokens[0] !== 'start') return { action: 'help' }

  const config_path = readFlag(tokens, ['--config'])
  const output_path = readFlag(tokens, ['--out', '--output'])
  if (!config_path || !output_path) return { action: 'help' }

  return {
    action: 'start',
    config_path,
    output_path,
    run_id: readFlag(tokens, ['--run-id']) || undefined,
    created_at: readFlag(tokens, ['--created-at']) || undefined,
  }
}

function defaultRunId(createdAt: string): string {
  return `train_${createdAt.replace(/[^0-9]/g, '').slice(0, 14)}`
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: unknown,
  args: string,
): Promise<null> {
  const parsed = parseLearningCommandArgs(args)
  if (parsed.action === 'help') {
    onDone(USAGE)
    return null
  }

  const created_at = parsed.created_at ?? new Date().toISOString()
  const result = launchTrainingRunFromConfigFile({
    config_path: parsed.config_path,
    output_path: parsed.output_path,
    run_id: parsed.run_id ?? defaultRunId(created_at),
    created_at,
  })

  if (result.manifest.status === 'started') {
    onDone(`Leviathan learning run started: ${result.output_path}`)
    return null
  }

  onDone(
    `Leviathan learning run blocked: ${result.manifest.blocked?.reasons.join(
      ', ',
    )}. Manifest: ${result.output_path}`,
  )
  return null
}
