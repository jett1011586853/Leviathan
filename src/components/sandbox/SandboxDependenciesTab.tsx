import React from 'react'

import { Box, Text } from '../../ink.js'
import { getPlatform } from '../../utils/platform.js'
import type { SandboxDependencyCheck } from '../../utils/sandbox/sandbox-adapter.js'

type Props = {
  depCheck: SandboxDependencyCheck
}

export function SandboxDependenciesTab({
  depCheck,
}: Props): React.ReactNode {
  const platform = getPlatform()
  const isMac = platform === 'macos'

  const rgMissing = depCheck.errors.some(error => error.includes('ripgrep'))
  const bwrapMissing = depCheck.errors.some(error => error.includes('bwrap'))
  const socatMissing = depCheck.errors.some(error => error.includes('socat'))
  const seccompMissing = depCheck.warnings.length > 0
  const otherErrors = depCheck.errors.filter(
    error =>
      !error.includes('ripgrep') &&
      !error.includes('bwrap') &&
      !error.includes('socat'),
  )
  const rgInstallHint = isMac ? 'brew install ripgrep' : 'apt install ripgrep'

  return (
    <Box flexDirection="column" paddingY={1} gap={1}>
      {isMac && (
        <Box flexDirection="column">
          <Text>
            seatbelt: <Text color="success">built-in (macOS)</Text>
          </Text>
        </Box>
      )}

      <Box flexDirection="column">
        <Text>
          ripgrep (rg):{' '}
          {rgMissing ? (
            <Text color="error">not found</Text>
          ) : (
            <Text color="success">found</Text>
          )}
        </Text>
        {rgMissing && <Text dimColor>{'  '}- {rgInstallHint}</Text>}
      </Box>

      {!isMac && (
        <>
          <Box flexDirection="column">
            <Text>
              bubblewrap (bwrap):{' '}
              {bwrapMissing ? (
                <Text color="error">not installed</Text>
              ) : (
                <Text color="success">installed</Text>
              )}
            </Text>
            {bwrapMissing && (
              <Text dimColor>{'  '}- apt install bubblewrap</Text>
            )}
          </Box>

          <Box flexDirection="column">
            <Text>
              socat:{' '}
              {socatMissing ? (
                <Text color="error">not installed</Text>
              ) : (
                <Text color="success">installed</Text>
              )}
            </Text>
            {socatMissing && <Text dimColor>{'  '}- apt install socat</Text>}
          </Box>

          <Box flexDirection="column">
            <Text>
              seccomp filter:{' '}
              {seccompMissing ? (
                <Text color="warning">not installed</Text>
              ) : (
                <Text color="success">installed</Text>
              )}
              {seccompMissing && (
                <Text dimColor> (required to block unix domain sockets)</Text>
              )}
            </Text>
            {seccompMissing && (
              <Box flexDirection="column">
                <Text dimColor>
                  {'  '}- copy vendor/seccomp/* and set
                </Text>
                <Text dimColor>
                  {'    '}sandbox.seccomp.bpfPath and applyPath in settings.json
                </Text>
              </Box>
            )}
          </Box>
        </>
      )}

      {otherErrors.map(error => (
        <Text key={error} color="error">
          {error}
        </Text>
      ))}
    </Box>
  )
}
