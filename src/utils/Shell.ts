import { execFileSync, spawn } from 'child_process'
import { constants as fsConstants, readFileSync, unlinkSync } from 'fs'
import { type FileHandle, mkdir, open, realpath } from 'fs/promises'
import memoize from 'lodash-es/memoize.js'
import { isAbsolute, resolve } from 'path'
import { join as posixJoin } from 'path/posix'
import { logEvent } from 'src/services/analytics/index.js'
import {
  getOriginalCwd,
  getSessionId,
  setCwdState,
} from '../bootstrap/state.js'
import { generateTaskId } from '../Task.js'
import { pwd } from './cwd.js'
import { logForDebugging } from './debug.js'
import { errorMessage, isENOENT } from './errors.js'
import { getFsImplementation } from './fsOperations.js'
import { logError } from './log.js'
import {
  createAbortedCommand,
  createFailedCommand,
  type ShellCommand,
  wrapSpawn,
} from './ShellCommand.js'
import { getTaskOutputDir } from './task/diskOutput.js'
import { TaskOutput } from './task/TaskOutput.js'
import { which } from './which.js'

export type { ExecResult } from './ShellCommand.js'

import { accessSync } from 'fs'
import { onCwdChangedForHooks } from './hooks/fileChangedWatcher.js'
import { getLeviathanTempDirName } from './permissions/filesystem.js'
import { getPlatform } from './platform.js'
import { SandboxManager } from './sandbox/sandbox-adapter.js'
import { invalidateSessionEnvCache } from './sessionEnvironment.js'
import { createBashShellProvider } from './shell/bashProvider.js'
import { getCachedPowerShellPath } from './shell/powershellDetection.js'
import { createPowerShellProvider } from './shell/powershellProvider.js'
import type { ShellProvider, ShellType } from './shell/shellProvider.js'
import { subprocessEnv } from './subprocessEnv.js'
import { posixPathToWindowsPath } from './windowsPaths.js'

const DEFAULT_TIMEOUT = 30 * 60 * 1000 // 30 minutes

export type ShellConfig = {
  provider: ShellProvider
}

function isExecutable(shellPath: string): boolean {
  try {
    accessSync(shellPath, fsConstants.X_OK)
    return true
  } catch (_err) {
    // Fallback for Nix and other environments where X_OK check might fail
    try {
      // Try to execute the shell with --version, which should exit quickly
      // Use execFileSync to avoid shell injection vulnerabilities
      execFileSync(shellPath, ['--version'], {
        timeout: 1000,
        stdio: 'ignore',
      })
      return true
    } catch {
      return false
    }
  }
}

/**
 * Windows-specific bash candidates, checked after `which bash` fails a probe.
 *
 * `which('bash')` on Windows resolves to C:\WINDOWS\system32\bash.exe whenever
 * WSL is installed, and that launcher is only a thin wrapper around the WSL
 * service: if the registered distro cannot start (moved or deleted ext4.vhdx,
 * stopped service, distro unregistered) every command exits 1 with an
 * unreadable UTF-16 dump from the service. Git for Windows ships a standalone
 * bash that works without WSL, so prefer it once the launcher is shown to be
 * broken.
 */
function getWindowsBashCandidates(): string[] {
  const candidates: string[] = []
  const programFiles = process.env.ProgramFiles
  const programFilesX86 = process.env['ProgramFiles(x86)']
  const localAppData = process.env.LOCALAPPDATA
  if (programFiles) {
    candidates.push(
      resolve(programFiles, 'Git', 'bin', 'bash.exe'),
      resolve(programFiles, 'Git', 'usr', 'bin', 'bash.exe'),
    )
  }
  if (programFilesX86) {
    candidates.push(
      resolve(programFilesX86, 'Git', 'bin', 'bash.exe'),
      resolve(programFilesX86, 'Git', 'usr', 'bin', 'bash.exe'),
    )
  }
  if (localAppData) {
    candidates.push(
      resolve(localAppData, 'Programs', 'Git', 'bin', 'bash.exe'),
    )
  }
  // WSL launcher last: usable only when the distro actually starts.
  candidates.push('C:\\WINDOWS\\system32\\bash.exe')
  return candidates
}

const SHELL_PROBE_TIMEOUT_MS = 5_000
const SHELL_PROBE_MARKER = 'leviathan-shell-probe-ok'
const shellProbeCache = new Map<string, boolean>()

/**
 * Run the shell for real before trusting it.
 *
 * isExecutable() only proves the file exists on Windows (fs.access X_OK maps
 * to a permission check that always passes), so a WSL launcher that cannot
 * start a distro looked healthy and the Bash tool failed on every call with a
 * garbled service error. Probing with one trivial command is the only way to
 * tell a working bash from a launcher that has nothing behind it.
 */
async function probePosixShell(shellPath: string): Promise<boolean> {
  const cached = shellProbeCache.get(shellPath)
  if (cached !== undefined) return cached

  const usable = await new Promise<boolean>(resolvePromise => {
    let settled = false
    const finish = (value: boolean) => {
      if (settled) return
      settled = true
      resolvePromise(value)
    }

    try {
      const child = spawn(shellPath, ['-c', `printf ${SHELL_PROBE_MARKER}`], {
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      })
      let stdout = ''
      const timer = setTimeout(() => {
        try {
          child.kill()
        } catch {
          // Process may have exited already.
        }
        finish(false)
      }, SHELL_PROBE_TIMEOUT_MS)

      child.stdout?.on('data', chunk => {
        stdout += chunk.toString()
      })
      child.on('error', () => {
        clearTimeout(timer)
        finish(false)
      })
      child.on('close', code => {
        clearTimeout(timer)
        finish(code === 0 && stdout.includes(SHELL_PROBE_MARKER))
      })
    } catch {
      finish(false)
    }
  })

  shellProbeCache.set(shellPath, usable)
  return usable
}

/**
 * Determines the best available shell to use.
 */
export async function findSuitableShell(): Promise<string> {
  // Check for explicit shell override first
  const shellOverride = process.env.LEVIATHAN_CODE_SHELL
  if (shellOverride) {
    // Validate it's a supported shell type
    const isSupported =
      shellOverride.includes('bash') || shellOverride.includes('zsh')
    if (isSupported && isExecutable(shellOverride)) {
      if (await probePosixShell(shellOverride)) {
        logForDebugging(`Using shell override: ${shellOverride}`)
        return shellOverride
      }
      logForDebugging(
        `LEVIATHAN_CODE_SHELL="${shellOverride}" exists but failed to run a trivial command; falling back to detection.`,
      )
    } else {
      // Note, if we ever want to add support for new shells here we'll need to update or Bash tool parsing to account for this
      logForDebugging(
        `LEVIATHAN_CODE_SHELL="${shellOverride}" is not a valid bash/zsh path, falling back to detection`,
      )
    }
  }

  // Check user's preferred shell from environment
  const env_shell = process.env.SHELL
  // Only consider SHELL if it's bash or zsh
  const isEnvShellSupported =
    env_shell && (env_shell.includes('bash') || env_shell.includes('zsh'))
  const preferBash = env_shell?.includes('bash')

  // Try to locate shells using which (uses Bun.which when available)
  const [zshPath, bashPath] = await Promise.all([which('zsh'), which('bash')])

  // Populate shell paths from which results and fallback locations
  const shellPaths = ['/bin', '/usr/bin', '/usr/local/bin', '/opt/homebrew/bin']

  // Order shells based on user preference
  const shellOrder = preferBash ? ['bash', 'zsh'] : ['zsh', 'bash']
  const supportedShells = shellOrder.flatMap(shell =>
    shellPaths.map(path => `${path}/${shell}`),
  )

  // Add discovered paths to the beginning of our search list
  // Put the user's preferred shell type first
  if (preferBash) {
    if (bashPath) supportedShells.unshift(bashPath)
    if (zshPath) supportedShells.push(zshPath)
  } else {
    if (zshPath) supportedShells.unshift(zshPath)
    if (bashPath) supportedShells.push(bashPath)
  }

  // Always prioritize SHELL env variable if it's a supported shell type
  if (isEnvShellSupported && isExecutable(env_shell)) {
    supportedShells.unshift(env_shell)
  }

  // Windows: `which bash` finds the WSL launcher first, which is useless when
  // the distro cannot start. Git for Windows ships a self-contained bash.
  // Appended after the discovered shells so an explicitly configured or
  // working default keeps priority; each candidate is probed below.
  if (getPlatform() === 'windows') {
    for (const candidate of getWindowsBashCandidates()) {
      supportedShells.push(candidate)
    }
  }

  const executableCandidates = supportedShells.filter(
    (shell): shell is string => Boolean(shell) && isExecutable(shell),
  )

  // Probe each candidate with a real command. The first one that actually runs
  // wins; an executable that cannot run (broken WSL launcher) is only used as a
  // last resort so the error surfaces instead of "no shell found".
  let shellPath: string | undefined
  for (const candidate of executableCandidates) {
    if (await probePosixShell(candidate)) {
      shellPath = candidate
      break
    }
    logForDebugging(
      `Shell candidate "${candidate}" is executable but failed its probe; trying the next one.`,
    )
  }
  if (!shellPath && executableCandidates.length > 0) {
    shellPath = executableCandidates[0]
    logForDebugging(
      `No shell passed the probe; falling back to "${shellPath}" and letting the command surface its own error.`,
    )
  }

  // If no valid shell found, throw a helpful error
  if (!shellPath) {
    const errorMsg =
      'No suitable shell found. Leviathan requires a Posix shell environment. ' +
      'Please ensure you have a valid shell installed and the SHELL environment variable set.'
    logError(new Error(errorMsg))
    throw new Error(errorMsg)
  }

  return shellPath
}

async function getShellConfigImpl(): Promise<ShellConfig> {
  const binShell = await findSuitableShell()
  const provider = await createBashShellProvider(binShell)
  return { provider }
}

// Memoize the entire shell config so it only happens once per session
export const getShellConfig = memoize(getShellConfigImpl)

export const getPsProvider = memoize(async (): Promise<ShellProvider> => {
  const psPath = await getCachedPowerShellPath()
  if (!psPath) {
    throw new Error('PowerShell is not available')
  }
  return createPowerShellProvider(psPath)
})

const resolveProvider: Record<ShellType, () => Promise<ShellProvider>> = {
  bash: async () => (await getShellConfig()).provider,
  powershell: getPsProvider,
}

export type ExecOptions = {
  timeout?: number
  onProgress?: (
    lastLines: string,
    allLines: string,
    totalLines: number,
    totalBytes: number,
    isIncomplete: boolean,
  ) => void
  preventCwdChanges?: boolean
  shouldUseSandbox?: boolean
  shouldAutoBackground?: boolean
  /** When provided, stdout is piped (not sent to file) and this callback fires on each data chunk. */
  onStdout?: (data: string) => void
}

/**
 * Execute a shell command using the environment snapshot
 * Creates a new shell process for each command execution
 */
export async function exec(
  command: string,
  abortSignal: AbortSignal,
  shellType: ShellType,
  options?: ExecOptions,
): Promise<ShellCommand> {
  const {
    timeout,
    onProgress,
    preventCwdChanges,
    shouldUseSandbox,
    shouldAutoBackground,
    onStdout,
  } = options ?? {}
  const commandTimeout = timeout || DEFAULT_TIMEOUT

  const provider = await resolveProvider[shellType]()

  const id = Math.floor(Math.random() * 0x10000)
    .toString(16)
    .padStart(4, '0')

  // Sandbox temp directory - use per-user directory name to prevent multi-user permission conflicts
  const sandboxTmpDir = posixJoin(
    process.env.LEVIATHAN_CODE_TMPDIR || '/tmp',
    getLeviathanTempDirName(),
  )

  const { commandString: builtCommand, cwdFilePath } =
    await provider.buildExecCommand(command, {
      id,
      sandboxTmpDir: shouldUseSandbox ? sandboxTmpDir : undefined,
      useSandbox: shouldUseSandbox ?? false,
    })

  let commandString = builtCommand

  let cwd = pwd()

  // Recover if the current working directory no longer exists on disk.
  // This can happen when a command deletes its own CWD (e.g., temp dir cleanup).
  try {
    await realpath(cwd)
  } catch {
    const fallback = getOriginalCwd()
    logForDebugging(
      `Shell CWD "${cwd}" no longer exists, recovering to "${fallback}"`,
    )
    try {
      await realpath(fallback)
      setCwdState(fallback)
      cwd = fallback
    } catch {
      return createFailedCommand(
        `Working directory "${cwd}" no longer exists. Please restart Leviathan from an existing directory.`,
      )
    }
  }

  // If already aborted, don't spawn the process at all
  if (abortSignal.aborted) {
    return createAbortedCommand()
  }

  const binShell = provider.shellPath

  // Sandboxed PowerShell: wrapWithSandbox hardcodes `<binShell> -c '<cmd>'` —
  // using pwsh there would lose -NoProfile -NonInteractive (profile load
  // inside sandbox → delays, stray output, may hang on prompts). Instead:
  //   • powershellProvider.buildExecCommand (useSandbox) pre-wraps as
  //     `pwsh -NoProfile -NonInteractive -EncodedCommand <base64>` — base64
  //     survives the runtime's shellquote.quote() layer
  //   • pass /bin/sh as the sandbox's inner shell to exec that invocation
  //   • outer spawn is also /bin/sh -c to parse the runtime's POSIX output
  // /bin/sh exists on every platform where sandbox is supported.
  const isSandboxedPowerShell = shouldUseSandbox && shellType === 'powershell'
  const sandboxBinShell = isSandboxedPowerShell ? '/bin/sh' : binShell

  if (shouldUseSandbox) {
    commandString = await SandboxManager.wrapWithSandbox(
      commandString,
      sandboxBinShell,
      undefined,
      abortSignal,
    )
    // Create sandbox temp directory for sandboxed processes with secure permissions
    try {
      const fs = getFsImplementation()
      await fs.mkdir(sandboxTmpDir, { mode: 0o700 })
    } catch (error) {
      logForDebugging(`Failed to create ${sandboxTmpDir} directory: ${error}`)
    }
  }

  const spawnBinary = isSandboxedPowerShell ? '/bin/sh' : binShell
  const shellArgs = isSandboxedPowerShell
    ? ['-c', commandString]
    : provider.getSpawnArgs(commandString)
  const envOverrides = await provider.getEnvironmentOverrides(command)

  // When onStdout is provided, use pipe mode: stdout flows through
  // StreamWrapper → TaskOutput in-memory buffer instead of a file fd.
  // This lets callers receive real-time stdout callbacks.
  const usePipeMode = !!onStdout
  const taskId = generateTaskId('local_bash')
  const taskOutput = new TaskOutput(taskId, onProgress ?? null, !usePipeMode)
  await mkdir(getTaskOutputDir(), { recursive: true })

  // In file mode, both stdout and stderr go to the same file fd.
  // On POSIX, O_APPEND makes each write atomic (seek-to-end + write), so
  // stdout and stderr are interleaved chronologically without tearing.
  // On Windows, 'a' mode strips FILE_WRITE_DATA (only grants FILE_APPEND_DATA)
  // via libuv's fs__open. MSYS2/Cygwin probes inherited handles with
  // NtQueryInformationFile(FileAccessInformation) and treats handles without
  // FILE_WRITE_DATA as read-only, silently discarding all output. Using 'w'
  // grants FILE_GENERIC_WRITE. Atomicity is preserved because duplicated
  // handles share the same FILE_OBJECT with FILE_SYNCHRONOUS_IO_NONALERT,
  // which serializes all I/O through a single kernel lock.
  // SECURITY: O_NOFOLLOW prevents symlink-following attacks from the sandbox.
  // On Windows, use string flags — numeric flags can produce EINVAL through libuv.
  let outputHandle: FileHandle | undefined
  if (!usePipeMode) {
    const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0
    outputHandle = await open(
      taskOutput.path,
      process.platform === 'win32'
        ? 'w'
        : fsConstants.O_WRONLY |
            fsConstants.O_CREAT |
            fsConstants.O_APPEND |
            O_NOFOLLOW,
    )
  }

  try {
    const childProcess = spawn(spawnBinary, shellArgs, {
      env: {
        ...subprocessEnv(),
        SHELL: shellType === 'bash' ? binShell : undefined,
        GIT_EDITOR: 'true',
        LEVIATHAN_CODE: '1',
        ...envOverrides,
        ...(process.env.USER_TYPE === 'ant'
          ? {
              LEVIATHAN_CODE_SESSION_ID: getSessionId(),
            }
          : {}),
      },
      cwd,
      stdio: usePipeMode
        ? ['pipe', 'pipe', 'pipe']
        : ['pipe', outputHandle?.fd, outputHandle?.fd],
      // Don't pass the signal - we'll handle termination ourselves with tree-kill
      detached: provider.detached,
      // Prevent visible console window on Windows (no-op on other platforms)
      windowsHide: true,
    })

    const shellCommand = wrapSpawn(
      childProcess,
      abortSignal,
      commandTimeout,
      taskOutput,
      shouldAutoBackground,
    )

    // Close our copy of the fd — the child has its own dup.
    // Must happen after wrapSpawn attaches 'error' listener, since the await
    // yields and the child's ENOENT 'error' event can fire in that window.
    // Wrapped in its own try/catch so a close failure (e.g. EIO) doesn't fall
    // through to the spawn-failure catch block, which would orphan the child.
    if (outputHandle !== undefined) {
      try {
        await outputHandle.close()
      } catch {
        // fd may already be closed by the child; safe to ignore
      }
    }

    // In pipe mode, attach the caller's callbacks alongside StreamWrapper.
    // Both listeners receive the same data chunks (Node.js ReadableStream supports
    // multiple 'data' listeners). StreamWrapper feeds TaskOutput for persistence;
    // these callbacks give the caller real-time access.
    if (childProcess.stdout && onStdout) {
      childProcess.stdout.on('data', (chunk: string | Buffer) => {
        onStdout(typeof chunk === 'string' ? chunk : chunk.toString())
      })
    }

    // Attach cleanup to the command result
    // NOTE: readFileSync/unlinkSync are intentional here — these must complete
    // synchronously within the .then() microtask so that callers who
    // `await shellCommand.result` see the updated cwd immediately after.
    // Using async readFile would introduce a microtask boundary, causing
    // a race where cwd hasn't been updated yet when the caller continues.

    // On Windows, cwdFilePath is a POSIX path (for bash's `pwd -P >| $path`),
    // but Node.js needs a native Windows path for readFileSync/unlinkSync.
    // Similarly, `pwd -P` outputs a POSIX path that must be converted before setCwd.
    const nativeCwdFilePath =
      getPlatform() === 'windows'
        ? posixPathToWindowsPath(cwdFilePath)
        : cwdFilePath

    void shellCommand.result.then(async result => {
      // On Linux, bwrap creates 0-byte mount-point files on the host to deny
      // writes to non-existent paths (.bashrc, HEAD, etc.). These persist after
      // bwrap exits as ghost dotfiles in cwd. Cleanup is synchronous and a no-op
      // on macOS. Keep before any await so callers awaiting .result see a clean
      // working tree in the same microtask.
      if (shouldUseSandbox) {
        SandboxManager.cleanupAfterCommand()
      }
      // Only foreground tasks update the cwd
      if (result && !preventCwdChanges && !result.backgroundTaskId) {
        try {
          let newCwd = readFileSync(nativeCwdFilePath, {
            encoding: 'utf8',
          }).trim()
          if (getPlatform() === 'windows') {
            newCwd = posixPathToWindowsPath(newCwd)
          }
          // cwd is NFC-normalized (setCwdState); newCwd from `pwd -P` may be
          // NFD on macOS APFS. Normalize before comparing so Unicode paths
          // don't false-positive as "changed" on every command.
          if (newCwd.normalize('NFC') !== cwd) {
            setCwd(newCwd, cwd)
            invalidateSessionEnvCache()
            void onCwdChangedForHooks(cwd, newCwd)
          }
        } catch {
          logEvent('tengu_shell_set_cwd', { success: false })
        }
      }
      // Clean up the temp file used for cwd tracking
      try {
        unlinkSync(nativeCwdFilePath)
      } catch {
        // File may not exist if command failed before pwd -P ran
      }
    })

    return shellCommand
  } catch (error) {
    // Close the fd if spawn failed (child never got its dup)
    if (outputHandle !== undefined) {
      try {
        await outputHandle.close()
      } catch {
        // May already be closed
      }
    }
    taskOutput.clear()

    logForDebugging(`Shell exec error: ${errorMessage(error)}`)

    return createAbortedCommand(undefined, {
      code: 126, // Standard Unix code for execution errors
      stderr: errorMessage(error),
    })
  }
}

/**
 * Set the current working directory
 */
export function setCwd(path: string, relativeTo?: string): void {
  const resolved = isAbsolute(path)
    ? path
    : resolve(relativeTo || getFsImplementation().cwd(), path)
  // Resolve symlinks to match the behavior of pwd -P.
  // realpathSync throws ENOENT if the path doesn't exist - convert to a
  // friendlier error message instead of a separate existsSync pre-check (TOCTOU).
  let physicalPath: string
  try {
    physicalPath = getFsImplementation().realpathSync(resolved)
  } catch (e) {
    if (isENOENT(e)) {
      throw new Error(`Path "${resolved}" does not exist`)
    }
    throw e
  }

  setCwdState(physicalPath)
  if (process.env.NODE_ENV !== 'test') {
    try {
      logEvent('tengu_shell_set_cwd', {
        success: true,
      })
    } catch (_error) {
      // Ignore logging errors to prevent test failures
    }
  }
}
