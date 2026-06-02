/* eslint-disable custom-rules/no-process-exit -- CLI subcommand handlers intentionally exit */

import React from 'react'
import { useManagePlugins } from '../../hooks/useManagePlugins.js'
import type { Root } from '../../ink.js'
import {
  LEGACY_ACCOUNT_FEATURE_NOTICE,
  LEVIATHAN_DISTRIBUTION_NOTICE,
} from '../../leviathan/branding.js'
import { KeybindingSetup } from '../../keybindings/KeybindingProviderSetup.js'
import { logEvent } from '../../services/analytics/index.js'
import { MCPConnectionManager } from '../../services/mcp/MCPConnectionManager.js'
import { AppStateProvider } from '../../state/AppState.js'

export async function setupTokenHandler(_root: Root): Promise<void> {
  process.stdout.write(`${LEGACY_ACCOUNT_FEATURE_NOTICE}\n`)
  process.exit(0)
}

const DoctorLazy = React.lazy(() =>
  import('../../screens/Doctor.js').then(module => ({
    default: module.Doctor,
  })),
)

function DoctorWithPlugins({
  onDone,
}: {
  onDone(): void
}): React.ReactNode {
  useManagePlugins()
  return (
    <React.Suspense fallback={null}>
      <DoctorLazy onDone={onDone} />
    </React.Suspense>
  )
}

export async function doctorHandler(root: Root): Promise<void> {
  logEvent('tengu_doctor_command', {})
  await new Promise<void>(resolve => {
    root.render(
      <AppStateProvider>
        <KeybindingSetup>
          <MCPConnectionManager
            dynamicMcpConfig={undefined}
            isStrictMcpConfig={false}
          >
            <DoctorWithPlugins onDone={() => void resolve()} />
          </MCPConnectionManager>
        </KeybindingSetup>
      </AppStateProvider>,
    )
  })
  root.unmount()
  process.exit(0)
}

export async function installHandler(
  _target: string | undefined,
  _options: { force?: boolean },
): Promise<void> {
  process.stderr.write(`${LEVIATHAN_DISTRIBUTION_NOTICE}\n`)
  process.exit(1)
}
