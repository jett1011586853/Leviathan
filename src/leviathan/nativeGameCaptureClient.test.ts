import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  NativeGameCaptureClient,
  resolveNativeGameCaptureBinary,
} from '../game/nativeCaptureClient.js'

describe('GameModel native capture protocol', () => {
  test('resolves the native binary from a bundled dist-startup module', async () => {
    const root = await mkdtemp(join(tmpdir(), 'leviathan-bundled-capture-'))
    const binary = join(
      root,
      'native',
      'game-capture',
      'target',
      'release',
      'leviathan-game-capture.exe',
    )
    try {
      await mkdir(resolve(binary, '..'), { recursive: true })
      await writeFile(binary, 'fixture')
      expect(
        resolveNativeGameCaptureBinary({
          cwd: tmpdir(),
          env: {},
          moduleDirectory: join(root, 'dist-startup'),
        }),
      ).toBe(binary)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('streams validated frames with bounded backpressure and closes cleanly', async () => {
    const sampleDirectory = await mkdtemp(
      join(tmpdir(), 'leviathan-native-capture-fixture-'),
    )
    const fixture = resolve(
      import.meta.dir,
      'fixtures',
      'nativeGameCaptureFixture.ts',
    )
    const client = new NativeGameCaptureClient({
      binaryPath: process.execPath,
      binaryArgs: [fixture],
      hwnd: '42',
      targetFps: 60,
      sessionId: 'native-client-test',
      adapterInstanceId: 'native-adapter-test',
      sampleDirectory,
      sampleFps: 2,
    })

    try {
      await client.start()
      await Bun.sleep(200)
      const frame = await client.nextFrame()
      expect(frame.sessionId).toBe('native-client-test')
      expect(frame.adapterInstanceId).toBe('native-adapter-test')
      expect(frame.motionGrid).toEqual([0.1, 0.2, 0.3, 0.4])
      const diagnostics = client.diagnostics()
      expect(diagnostics.status).toBe('active')
      expect(diagnostics.nativeFrameCount).toBeGreaterThan(3)
      expect(diagnostics.droppedFrameCount).toBeGreaterThan(0)
      expect(diagnostics.measuredFps).toBe(60)
      expect(diagnostics.sampledFrameCount).toBeGreaterThan(0)
      expect((await readdir(sampleDirectory)).length).toBeGreaterThan(0)
    } finally {
      await client.close()
      await rm(sampleDirectory, { recursive: true, force: true })
    }

    expect(client.diagnostics().status).toBe('stopped')
  })
})
