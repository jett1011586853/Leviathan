import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { FrameRingBuffer } from '../game/frameRingBuffer.js'
import { GameInputController } from '../game/inputController.js'
import { selectGameWindowCandidate } from '../game/menuAutomation.js'
import {
  resolveCalibrationReferenceImage,
  saveGameCalibration,
} from '../game/calibration.js'
import { NzmFutureObservePerceptionDetector } from '../game/nzmFuturePerception.js'
import { TrustedGameObservationGate } from '../game/perceptionAdapter.js'
import {
  ensureGameProfile,
  loadGameProfile,
  saveGameCaptureConfig,
} from '../game/profile.js'
import { evaluateGameReplay } from '../game/replayEvaluator.js'
import { shouldPersistSampleAtRate } from '../game/sidecar.js'
import {
  disposeGameRuntimeForTests,
  getGameSessionSummary,
  pauseGameSession,
  resumeGameSession,
  resolveGameSidecarLaunchSpec,
  startGameSession,
  stopGameSession,
} from '../game/runtimeManager.js'
import {
  createGameControlPlan,
  decideGameIntent,
} from '../game/tacticalPolicy.js'
import {
  applyGameObservation,
  createInitialGameWorldState,
} from '../game/worldState.js'

afterEach(async () => {
  await disposeGameRuntimeForTests()
})

describe('GameModel realtime core', () => {
  test('relaunches the Leviathan startup entry when running from a JavaScript bundle', () => {
    const executablePath = 'C:\\runtime\\bun.exe'
    const launcherPath = resolve(
      import.meta.dir,
      '..',
      '..',
      'scripts',
      'start-leviathan.ts',
    )
    const launch = resolveGameSidecarLaunchSpec({
      executablePath,
      invocationEntry: launcherPath,
      moduleDirectory: join(tmpdir(), 'leviathan-dist-startup'),
      nativeBundle: false,
    })

    expect(launch).toEqual({
      command: executablePath,
      args: ['run', launcherPath, '--game-runtime-sidecar'],
    })
  })

  test('self-launches a compiled Leviathan binary without a Bun script entry', () => {
    const launch = resolveGameSidecarLaunchSpec({
      executablePath: 'C:\\Leviathan\\leviathan.exe',
      invocationEntry: undefined,
      moduleDirectory: join(tmpdir(), 'leviathan-native-bundle'),
      nativeBundle: true,
    })

    expect(launch).toEqual({
      command: 'C:\\Leviathan\\leviathan.exe',
      args: ['--game-runtime-sidecar'],
    })
  })

  test('starts and stops a sidecar when a launcher imports the JavaScript bundle', async () => {
    const repoRoot = resolve(import.meta.dir, '..', '..')
    const buildDir = await mkdtemp(join(repoRoot, '.gamemodel-bundle-test-'))
    const workspace = await mkdtemp(
      join(tmpdir(), 'leviathan-game-bundle-workspace-'),
    )
    const fixturePath = join(
      repoRoot,
      'src',
      'leviathan',
      'fixtures',
      'gameModelBundleHarness.ts',
    )
    const bundlePath = join(buildDir, 'bundle-harness.js')
    const launcherPath = join(buildDir, 'launcher.ts')

    try {
      const build = Bun.spawn({
        cmd: [
          process.execPath,
          'build',
          fixturePath,
          '--target=bun',
          '--packages=external',
          '--outfile',
          bundlePath,
        ],
        cwd: repoRoot,
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const [buildExit, buildStderr] = await Promise.all([
        build.exited,
        new Response(build.stderr).text(),
      ])
      expect(buildExit, buildStderr).toBe(0)
      await writeFile(
        launcherPath,
        "await import('./bundle-harness.js')\n",
        'utf8',
      )

      const bundledRuntime = Bun.spawn({
        cmd: [process.execPath, 'run', launcherPath],
        cwd: workspace,
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const [exitCode, stdout, stderr] = await Promise.all([
        bundledRuntime.exited,
        new Response(bundledRuntime.stdout).text(),
        new Response(bundledRuntime.stderr).text(),
      ])
      expect(exitCode, stderr).toBe(0)
      expect(JSON.parse(stdout.trim())).toEqual({
        started: 'running',
        stopped: 'stopped',
      })
    } finally {
      await rm(buildDir, { recursive: true, force: true })
      await rm(workspace, { recursive: true, force: true })
    }
  }, 30_000)

  test('keeps only the configured temporal frame window', () => {
    const ring = new FrameRingBuffer<{ timestamp: number; value: number }>(1000)
    ring.push({ timestamp: 1000, value: 1 })
    ring.push({ timestamp: 1500, value: 2 })
    ring.push({ timestamp: 2200, value: 3 })
    expect(ring.values(2200).map((item) => item.value)).toEqual([2, 3])
  })

  test('defaults new profiles to native WGC and persists explicit capture choices', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'leviathan-game-capture-profile-'))
    const created = await ensureGameProfile(cwd)
    expect(created.profile.capture).toMatchObject({
      backend: 'windows_graphics_capture',
      fps: 60,
      recordFrames: false,
      datasetSampleFps: 2,
    })

    const configured = await saveGameCaptureConfig({
      cwd,
      backend: 'windows_gdi_fallback',
      fps: 5,
      recordFrames: true,
      datasetSampleFps: 2,
    })
    expect(configured.profile.capture).toMatchObject({
      backend: 'windows_gdi_fallback',
      fps: 5,
      recordFrames: true,
    })
  })

  test('migrates the built-in game profile to the real NZM process name', async () => {
    const cwd = await mkdtemp(
      join(tmpdir(), 'leviathan-game-profile-migration-'),
    )
    const created = await ensureGameProfile(cwd)
    await writeFile(
      created.path,
      `${JSON.stringify({
        ...created.profile,
        window: { ...created.profile.window, processNames: [] },
      })}\n`,
      'utf8',
    )

    const migrated = await loadGameProfile(cwd)
    expect(migrated.window.processNames).toContain('NZMClient')
  })

  test('prefers the real game process over a blocked terminal with a matching title', async () => {
    const cwd = await mkdtemp(
      join(tmpdir(), 'leviathan-game-window-selection-'),
    )
    const { profile } = await ensureGameProfile(cwd)
    const selected = selectGameWindowCandidate(profile, [
      {
        hwnd: 'terminal',
        title: '逆战未来窗口截图与ROI配置',
        processName: 'WindowsTerminal',
        processId: 1,
        bounds: { x: 0, y: 0, width: 1400, height: 875 },
        blockedReason: 'Blocked for safety: terminal application.',
      },
      {
        hwnd: 'game',
        title: '逆战：未来',
        processName: 'NZMClient',
        processId: 2,
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      },
    ])

    expect(selected?.hwnd).toBe('game')
  })

  test('enforces dataset sampling independently from fallback capture FPS', () => {
    expect(shouldPersistSampleAtRate(0, 1_000, 2)).toBe(true)
    expect(shouldPersistSampleAtRate(1_000, 1_200, 2)).toBe(false)
    expect(shouldPersistSampleAtRate(1_000, 1_500, 2)).toBe(true)
    expect(shouldPersistSampleAtRate(0, 1_000, 0)).toBe(false)
  })

  test('accepts only capability-scoped observations from the trusted adapter identity', () => {
    const now = Date.now()
    const gate = new TrustedGameObservationGate('session-1', {
      schemaVersion: 1,
      adapterId: 'test.motion-adapter',
      adapterInstanceId: 'adapter-instance-1',
      kind: 'capture',
      captureBackend: 'test_capture',
      capabilities: ['frame.viewport', 'frame.motion'],
    })
    const trusted = gate.accept(
      {
        schemaVersion: 1,
        sessionId: 'session-1',
        adapterInstanceId: 'adapter-instance-1',
        sequence: 1,
        capturedAt: now,
        observation: {
          frameId: 1,
          viewport: { width: 1920, height: 1080 },
          motionScore: 0.25,
        },
      },
      now + 10,
    )

    expect(trusted.provenance.trust).toBe('sidecar_adapter')
    expect(trusted.provenance.observationSha256).toHaveLength(64)
    expect(gate.summary().trustedObservationCount).toBe(1)

    expect(() =>
      gate.accept(
        {
          schemaVersion: 1,
          sessionId: 'session-1',
          adapterInstanceId: 'adapter-instance-1',
          sequence: 2,
          capturedAt: now + 20,
          observation: { frameId: 2, health: 100 },
        },
        now + 30,
      ),
    ).toThrow('missing capability hud.health')
    expect(gate.summary().rejectedObservationCount).toBe(1)
  })

  test('detects calibrated combat HUD evidence without promoting a blank frame', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'leviathan-nzm-perception-'))
    const referenceImage = await createSyntheticNzmFrame(true)
    const saved = await saveGameCalibration({
      cwd,
      profileId: 'com.leviathan.game.nzm-future',
      referenceImage,
      windowViewport: { width: 640, height: 400 },
      regions: [
        {
          id: 'minimap',
          kind: 'minimap',
          rect: { x: 0, y: 0, width: 0.2, height: 0.3 },
          enabled: true,
        },
        {
          id: 'hud_health',
          kind: 'hud_health',
          rect: { x: 0, y: 0.8, width: 0.25, height: 0.2 },
          enabled: true,
        },
        {
          id: 'hud_ammo',
          kind: 'hud_ammo',
          rect: { x: 0.75, y: 0.8, width: 0.25, height: 0.2 },
          enabled: true,
        },
        {
          id: 'objective_arrow',
          kind: 'objective_arrow',
          rect: { x: 0.3, y: 0, width: 0.4, height: 0.2 },
          enabled: true,
        },
      ],
    })
    const detector = await NzmFutureObservePerceptionDetector.create({
      calibrationPath: saved.path,
      calibration: saved.calibration,
    })
    expect(detector.capabilities).toEqual(['game.phase', 'vision.threats'])

    const combat = await detector.analyze(referenceImage)
    expect(combat.observation.phase).toBe('combat')
    expect(combat.phaseConfidence).toBeGreaterThanOrEqual(0.66)
    expect('objectiveArrow' in combat.observation).toBe(false)
    expect(combat.objectiveCandidate?.confidence).toBeGreaterThan(0)
    expect(combat.observation.threats?.length).toBeGreaterThan(0)

    const blank = await detector.analyze(await createSyntheticNzmFrame(false))
    expect(blank.observation.phase).toBe('unknown')
    expect(blank.objectiveCandidate).toBeUndefined()
    expect(blank.observation.threats).toEqual([])

    await writeFile(
      resolveCalibrationReferenceImage(saved.path, saved.calibration),
      await createSyntheticNzmFrame(false),
    )
    await expect(
      NzmFutureObservePerceptionDetector.create({
        calibrationPath: saved.path,
        calibration: saved.calibration,
      }),
    ).rejects.toThrow('reference image digest mismatch')
  })

  test('maintains target identity and predicts motion between observations', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'leviathan-game-profile-'))
    const { profile } = await ensureGameProfile(cwd)
    let world = createInitialGameWorldState(1000)
    world = applyGameObservation(
      world,
      {
        timestamp: 1000,
        phase: 'combat',
        viewport: { width: 1000, height: 500 },
        targets: [{ id: 'a', confidence: 0.9, screenX: 450, screenY: 250 }],
      },
      profile,
    )
    expect(world.selectedTargetId).toBe('a')

    world = applyGameObservation(
      world,
      {
        timestamp: 1100,
        targets: [
          { id: 'a', confidence: 0.8, screenX: 470, screenY: 250 },
          {
            id: 'b',
            confidence: 0.99,
            threat: 1,
            screenX: 500,
            screenY: 250,
          },
        ],
      },
      profile,
    )
    expect(world.selectedTargetId).toBe('a')
    expect(
      world.targets.find((target) => target.id === 'a')!.predictedX,
    ).toBeGreaterThan(470)

    world = applyGameObservation(
      world,
      {
        timestamp: 1800,
        targets: [
          { id: 'a', confidence: 0.5, screenX: 490, screenY: 250 },
          {
            id: 'b',
            confidence: 0.99,
            threat: 1,
            screenX: 500,
            screenY: 250,
          },
        ],
      },
      profile,
    )
    expect(world.selectedTargetId).toBe('b')
  })

  test('prioritizes safety and produces lease-bound control plans', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'leviathan-game-policy-'))
    const { profile } = await ensureGameProfile(cwd)
    const world = applyGameObservation(
      createInitialGameWorldState(1000),
      {
        timestamp: 1000,
        phase: 'combat',
        viewport: { width: 1000, height: 500 },
        ammo: { current: 20, reserve: 100 },
        health: 20,
        threats: [
          {
            confidence: 0.9,
            direction: 'left',
            attackImminent: true,
          },
        ],
        targets: [{ id: 'boss', confidence: 0.99, screenX: 500, screenY: 250 }],
      },
      profile,
    )
    const gameIntent = decideGameIntent(world, profile, 1000)
    const plan = createGameControlPlan(world, profile, gameIntent)
    expect(gameIntent.kind).toBe('evade')
    expect(plan.desiredKeys).toContain('D')
    expect(plan.leaseMs).toBe(profile.policy.actionLeaseMs)
  })

  test('refuses live input when the configured game window is not foreground', async () => {
    const controller = new GameInputController('live', '0')
    try {
      await expect(
        controller.applyPlan({
          intent: {
            kind: 'navigate',
            priority: 1,
            reason: 'input bridge safety test',
            createdAt: Date.now(),
          },
          desiredKeys: ['W'],
          tapKeys: [],
          fire: false,
          leaseMs: 100,
        }),
      ).rejects.toThrow('not foreground')
    } finally {
      await controller.close()
    }
  })

  test('runs an observation sidecar lifecycle and writes replay artifacts', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'leviathan-game-runtime-'))
    const ensured = await ensureGameProfile(cwd)
    const profile = {
      ...ensured.profile,
      capture: {
        ...ensured.profile.capture,
        backend: 'windows_gdi_fallback' as const,
        fps: 5,
      },
    }
    const started = await startGameSession({
      cwd,
      controlMode: 'observe',
      objective: 'Collect a deterministic combat trace.',
      profile,
      profilePath: ensured.path,
    })
    expect(started.status).toBe('running')
    expect(started.controlMode).toBe('observe')

    expect(started.observationCount).toBe(0)
    expect(started.perception.status).toBe('active')
    expect(started.perception.capabilities).toEqual([
      'frame.viewport',
      'frame.motion',
    ])

    expect((await pauseGameSession()).status).toBe('paused')
    expect((await resumeGameSession()).status).toBe('running')
    expect((await getGameSessionSummary())?.sessionId).toBe(started.sessionId)
    const stopped = await stopGameSession()
    expect(stopped?.status).toBe('stopped')

    const sessionJson = JSON.parse(
      await readFile(join(started.sessionDir, 'session.json'), 'utf8'),
    ) as { status: string }
    expect(sessionJson.status).toBe('stopped')
    expect(
      await readFile(join(started.sessionDir, 'events.jsonl'), 'utf8'),
    ).toContain('session_stopped')
  })

  test('evaluates only evidence present in replay JSONL', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'leviathan-game-replay-'))
    const ensured = await ensureGameProfile(cwd)
    const replayPath = join(cwd, 'replay.jsonl')
    await writeFile(
      replayPath,
      [
        JSON.stringify({
          timestamp: 1000,
          phase: 'combat',
          viewport: { width: 1000, height: 500 },
          objectiveArrow: { angleDeg: 12, confidence: 0.9 },
        }),
        JSON.stringify({
          timestamp: 2000,
          phase: 'settlement',
        }),
      ].join('\n'),
      'utf8',
    )
    const result = await evaluateGameReplay({
      replayPath,
      profile: ensured.profile,
    })
    expect(result.evaluation.sampleCount).toBe(2)
    expect(result.evaluation.trustedSampleCount).toBe(0)
    expect(result.evaluation.legacyUnverifiedSampleCount).toBe(2)
    expect(result.evaluation.invalidProvenanceSampleCount).toBe(0)
    expect(result.evaluation.staleGapCount).toBe(1)
    expect(result.evaluation.phaseCounts.combat).toBe(1)
    expect(result.evaluation.phaseCounts.settlement).toBe(1)
  })

  test('detects modified observations instead of trusting provenance text', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'leviathan-game-provenance-'))
    const ensured = await ensureGameProfile(cwd)
    const replayPath = join(cwd, 'trusted-replay.jsonl')
    const capturedAt = Date.now()
    const gate = new TrustedGameObservationGate('session-audit', {
      schemaVersion: 1,
      adapterId: 'test.audit-adapter',
      adapterInstanceId: 'audit-instance',
      kind: 'capture',
      captureBackend: 'test_capture',
      capabilities: ['frame.viewport', 'frame.motion'],
    })
    const trusted = gate.accept(
      {
        schemaVersion: 1,
        sessionId: 'session-audit',
        adapterInstanceId: 'audit-instance',
        sequence: 1,
        capturedAt,
        observation: {
          frameId: 1,
          viewport: { width: 1280, height: 720 },
          motionScore: 0.1,
        },
      },
      capturedAt + 1,
    )
    await writeFile(
      replayPath,
      `${JSON.stringify(trusted)}\n${JSON.stringify({
        ...trusted,
        motionScore: 0.99,
      })}\n`,
      'utf8',
    )

    const result = await evaluateGameReplay({
      replayPath,
      profile: ensured.profile,
    })
    expect(result.evaluation.trustedSampleCount).toBe(1)
    expect(result.evaluation.invalidProvenanceSampleCount).toBe(1)
    expect(result.evaluation.adapterCounts['test.audit-adapter']).toBe(1)
  })
})

async function createSyntheticNzmFrame(withHud: boolean): Promise<Buffer> {
  const overlays = withHud
    ? `<circle cx="52" cy="52" r="42" fill="none" stroke="#eeeeee" stroke-width="3"/>
       <path d="M18 55 L48 28 L80 52 L100 34" fill="none" stroke="#eeeeee" stroke-width="2"/>
       <circle cx="38" cy="42" r="4" fill="#ef3340"/>
       <circle cx="68" cy="34" r="4" fill="#ef3340"/>
       <rect x="12" y="336" width="128" height="12" fill="#42bde8"/>
       <rect x="12" y="356" width="100" height="9" fill="#d6f7ff"/>
       <rect x="512" y="340" width="94" height="9" fill="#f2f2f2"/>
       <rect x="540" y="360" width="74" height="12" fill="#ffffff"/>
       <polygon points="356,15 368,27 356,39 344,27" fill="#d8a528"/>`
    : ''
  return await sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400">
         <rect width="640" height="400" fill="#20252b"/>
         ${overlays}
       </svg>`,
    ),
  )
    .png()
    .toBuffer()
}
