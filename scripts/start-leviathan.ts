import path from 'node:path'
import { pathToFileURL } from 'node:url'

const repoRoot = path.resolve(import.meta.dir, '..')
const entrypoint = path.join(repoRoot, 'dist-startup', 'cli.js')
const gameCaptureBinary = path.join(
  repoRoot,
  'native',
  'game-capture',
  'target',
  'release',
  'leviathan-game-capture.exe',
)
const sourceGlob = new Bun.Glob('src/**/*.{ts,tsx,js,jsx,json,txt}')
const gameCaptureSourceGlob = new Bun.Glob('native/game-capture/src/**/*.rs')

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

async function getLatestGameCaptureInputMtime(): Promise<number> {
  let latestMtime = 0
  for await (const filePath of gameCaptureSourceGlob.scan({
    cwd: repoRoot,
    absolute: true,
    onlyFiles: true,
  })) {
    latestMtime = Math.max(
      latestMtime,
      (await Bun.file(filePath).stat()).mtimeMs,
    )
  }
  for (const name of ['Cargo.toml', 'Cargo.lock']) {
    const file = Bun.file(path.join(repoRoot, 'native', 'game-capture', name))
    if (await file.exists()) {
      latestMtime = Math.max(latestMtime, (await file.stat()).mtimeMs)
    }
  }
  return latestMtime
}

async function prepareGameCaptureBinary(): Promise<void> {
  if (process.platform !== 'win32') return
  const artifact = Bun.file(gameCaptureBinary)
  const artifactMtime = (await artifact.exists())
    ? (await artifact.stat()).mtimeMs
    : 0
  if (artifactMtime < (await getLatestGameCaptureInputMtime())) {
    const build = Bun.spawn({
      cmd: [process.execPath, 'run', 'build:game-capture'],
      cwd: repoRoot,
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    })
    const exitCode = await build.exited
    if (exitCode !== 0) {
      console.warn(
        `Leviathan native game capture build failed with exit code ${exitCode}; GameModel will use its GDI fallback.`,
      )
    }
  }
  if (await artifact.exists()) {
    process.env.LEVIATHAN_GAME_CAPTURE_BINARY = gameCaptureBinary
  }
}

await buildIfStale()
await prepareGameCaptureBinary()
await import(pathToFileURL(entrypoint).href)
