import { ensureGameProfile } from '../../game/profile.js'
import {
  disposeGameRuntimeForTests,
  startGameSession,
  stopGameSession,
} from '../../game/runtimeManager.js'
import { runGameSidecarProcess } from '../../game/sidecar.js'

if (process.argv.slice(2)[0] === '--game-runtime-sidecar') {
  await runGameSidecarProcess()
} else {
  const cwd = process.cwd()
  const ensured = await ensureGameProfile(cwd)
  try {
    const started = await startGameSession({
      cwd,
      controlMode: 'observe',
      objective: 'Verify GameModel sidecar startup from a bundled entry.',
      profile: ensured.profile,
      profilePath: ensured.path,
    })
    const stopped = await stopGameSession()
    process.stdout.write(
      `${JSON.stringify({
        started: started.status,
        stopped: stopped?.status,
      })}\n`,
    )
  } finally {
    await disposeGameRuntimeForTests()
  }
}
