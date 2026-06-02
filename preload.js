// Preload: .env + TTY fix + MACRO + stdin polyfill
const { readFileSync, existsSync, mkdirSync } = require('fs')
const { resolve } = require('path')

// Load .env
try {
  const envPath = resolve(process.cwd(), '.env')
  if (existsSync(envPath)) {
    const lines = readFileSync(envPath, 'utf8').split('\n')
    for (const line of lines) {
      const t = line.trim()
      if (!t || t[0] === '#') continue
      const i = t.indexOf('=')
      if (i === -1) continue
      const key = t.slice(0, i).trim()
      if (!process.env[key]) process.env[key] = t.slice(i + 1).trim()
    }
  }
} catch(e) {}

// Fix Windows TTY (Bun doesn't set isTTY on win32)
if (process.platform === 'win32') {
  try {
    if (process.stdout.isTTY === undefined)
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true, writable: true })
    if (process.stdin.isTTY === undefined)
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true, writable: true })
    if (process.stderr.isTTY === undefined)
      Object.defineProperty(process.stderr, 'isTTY', { value: true, configurable: true, writable: true })
  } catch(e) {}
}

// Polyfill stdin/stdout TTY methods (missing on Windows Bun)
const patchStream = (stream) => {
  if (typeof stream.ref !== 'function')
    stream.ref = function() { return this }
  if (typeof stream.unref !== 'function')
    stream.unref = function() { return this }
  if (typeof stream.setRawMode !== 'function')
    stream.setRawMode = function(mode) { this._rawMode = mode; return this }
  if (typeof stream.isRawMode !== 'function')
    stream.isRawMode = function() { return !!this._rawMode }
}
patchStream(process.stdin)
patchStream(process.stdout)
patchStream(process.stderr)

// Bun build-time macros
globalThis.MACRO = { VERSION: '1.0.0-dev', BUILD_TIME: new Date().toISOString() }
// Leviathan branding
globalThis.MACRO.BRAND = 'Leviathan'

// Debug: log all errors to file
const { writeFileSync: _wfs } = require('fs')
const debugDir = resolve(process.cwd(), '.leviathan')
try { mkdirSync(debugDir, { recursive: true }) } catch(_) {}
process.on('uncaughtException', e => { try { _wfs(resolve(debugDir, '_crash.log'), String((e && e.stack) || e)) } catch(_) {} })
process.on('unhandledRejection', e => { try { _wfs(resolve(debugDir, '_crash.log'), String((e && e.stack) || e)) } catch(_) {} })

// Debug: tee stdout to file
const { createWriteStream } = require('fs')
try {
  const logStream = createWriteStream(resolve(debugDir, '_stdout.log'))
  const origWrite = process.stdout.write.bind(process.stdout)
  process.stdout.write = function(chunk, encoding, cb) {
    try { logStream.write(typeof chunk === 'string' ? chunk : chunk.toString()) } catch(_) {}
    return origWrite(chunk, encoding, cb)
  }
} catch(_) {}
