import { basename, dirname, join, resolve } from 'path'

export function getAwmpStateRoot(cwd = process.cwd()): string {
  return resolve(cwd, '.leviathan', 'awmp')
}

export function getDefaultModeRoots(cwd = process.cwd()): string[] {
  const roots = [
    process.env.LEVIATHAN_AWMP_MODES_DIR,
    join(cwd, '.leviathan', 'awmp', 'modes'),
    join(cwd, 'awmp', 'modes'),
  ].filter(Boolean) as string[]

  return uniqueResolved(roots)
}

export function inferModeRootsFromTaskPath(taskPath: string): string[] {
  const taskDir = dirname(resolve(taskPath))
  const maybeExamplesDir = dirname(taskDir)
  if (basename(taskDir) === 'tasks' && basename(maybeExamplesDir) === 'examples') {
    return [join(maybeExamplesDir, 'modes')]
  }

  return []
}

export function resolveModeRoots(options: {
  cwd?: string
  explicitModeRoots?: string[]
  taskPath?: string
}): string[] {
  return uniqueResolved([
    ...(options.explicitModeRoots ?? []),
    ...(options.taskPath === undefined
      ? []
      : inferModeRootsFromTaskPath(options.taskPath)),
    ...getDefaultModeRoots(options.cwd),
  ])
}

export function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '') || 'item'
}

function uniqueResolved(paths: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const path of paths) {
    const resolved = resolve(path)
    const key = resolved.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(resolved)
  }
  return result
}
