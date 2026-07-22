import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

const values = new Map<string, string>()
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index]
  const value = process.argv[index + 1]
  if (key && value) values.set(key, value)
}

const sessionId = values.get('--session-id') ?? 'missing-session'
const adapterInstanceId =
  values.get('--adapter-instance-id') ?? 'missing-adapter'
const hwnd = Number(values.get('--hwnd') ?? '1')
const targetFps = Number(values.get('--target-fps') ?? '60')
const parentPid = Number(values.get('--parent-pid') ?? process.ppid)
const recordingPath = values.get('--record-path') ?? null
const sampleDirectory = values.get('--sample-dir') ?? null
const sampleFps = Number(values.get('--sample-fps') ?? '0')
let sequence = 0
let sampledFrames = 0
let stopped = false

write({
  type: 'ready',
  protocolVersion: 1,
  backend: 'windows_graphics_capture',
  sessionId,
  adapterInstanceId,
  processId: process.pid,
  hwnd,
  targetFps,
  parentPid,
  recordingPath,
  sampleDirectory,
  sampleFps,
})

const timer = setInterval(() => {
  sequence += 1
  let samplePath: string | null = null
  let sampleSha256: string | null = null
  if (sampleDirectory && sampleFps > 0 && sequence % 10 === 0) {
    const encoded = Buffer.from(`fixture-frame-${sequence}`)
    mkdirSync(sampleDirectory, { recursive: true })
    samplePath = join(sampleDirectory, `${String(sequence).padStart(8, '0')}.png`)
    writeFileSync(samplePath, encoded)
    sampleSha256 = createHash('sha256').update(encoded).digest('hex')
    sampledFrames += 1
  }
  write({
    type: 'frame',
    protocolVersion: 1,
    sessionId,
    adapterInstanceId,
    sequence,
    capturedAt: Date.now(),
    width: 1280,
    height: 720,
    frameSha256: String(sequence).padStart(64, '0'),
    motionScore: 0.12,
    motionGridColumns: 2,
    motionGridRows: 2,
    motionGrid: [0.1, 0.2, 0.3, 0.4],
    meanLuma: 0.35,
    lumaStdDev: 0.18,
    blackFrameProbability: 0,
    measuredFps: targetFps,
    processingMs: 4.5,
    samplePath,
    sampleSha256,
  })
}, 5)

const readline = createInterface({ input: process.stdin })
readline.on('line', line => {
  if (line.trim().toLowerCase() === 'stop') shutdown()
})
readline.on('close', shutdown)

function shutdown(): void {
  if (stopped) return
  stopped = true
  clearInterval(timer)
  write({
    type: 'stopped',
    protocolVersion: 1,
    sessionId,
    adapterInstanceId,
    sequence,
    capturedFrames: sequence,
    sampledFrames,
    recordingPath,
  })
  setTimeout(() => process.exit(0), 5)
}

function write(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}
