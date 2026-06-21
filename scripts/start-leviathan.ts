import path from 'node:path'
import { pathToFileURL } from 'node:url'

const repoRoot = path.resolve(import.meta.dir, '..')
const entrypoint = path.join(repoRoot, 'dist-startup', 'cli.js')
const sourceGlob = new Bun.Glob('src/**/*.{ts,tsx,js,jsx,json,txt}')

async function getLatestInputMtime(): Promise<number> {
  let latestMtime = 0

  for await (const filePath of sourceGlob.scan({
    cwd: repoRoot,
    absolute: true,
    onlyFiles: true,
  })) {
    const stat = await Bun.file(filePath).stat()
    latestMtime = Math.max(latestMtime, stat.mtimeMs)
  }

  for (const name of ['package.json', 'bun.lock', 'tsconfig.json']) {
    const file = Bun.file(path.join(repoRoot, name))
    if (await file.exists()) {
      const stat = await file.stat()
      latestMtime = Math.max(latestMtime, stat.mtimeMs)
    }
  }

  return latestMtime
}

async function buildIfStale(): Promise<void> {
  const artifact = Bun.file(entrypoint)
  const artifactMtime = (await artifact.exists())
    ? (await artifact.stat()).mtimeMs
    : 0

  if (artifactMtime >= (await getLatestInputMtime())) {
    return
  }

  const build = Bun.spawn({
    cmd: [process.execPath, 'run', 'build:startup'],
    cwd: repoRoot,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const exitCode = await build.exited
  if (exitCode !== 0) {
    throw new Error(`Leviathan startup build failed with exit code ${exitCode}`)
  }
}

await buildIfStale()
await import(pathToFileURL(entrypoint).href)
