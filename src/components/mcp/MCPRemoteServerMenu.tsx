import figures from 'figures'
import React, { useEffect, useRef, useState } from 'react'
import type { CommandResultDisplay } from '../../commands.js'
import { useExitOnCtrlCDWithKeybindings } from '../../hooks/useExitOnCtrlCDWithKeybindings.js'
import { setClipboard } from '../../ink/termio/osc.js'
import { Box, color, Link, Text, useInput, useTheme } from '../../ink.js'
import {
  AuthenticationCancelledError,
  performMCPOAuthFlow,
  revokeServerTokens,
} from '../../services/mcp/auth.js'
import { clearServerCache } from '../../services/mcp/client.js'
import {
  useMcpReconnect,
  useMcpToggleEnabled,
} from '../../services/mcp/MCPConnectionManager.js'
import {
  describeMcpConfigFilePath,
  excludeCommandsByServer,
  excludeResourcesByServer,
  excludeToolsByServer,
  filterMcpPromptsByServer,
} from '../../services/mcp/utils.js'
import { useAppState, useSetAppState } from '../../state/AppState.js'
import { errorMessage } from '../../utils/errors.js'
import { capitalize } from '../../utils/stringUtils.js'
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js'
import { Select } from '../CustomSelect/index.js'
import { Byline } from '../design-system/Byline.js'
import { KeyboardShortcutHint } from '../design-system/KeyboardShortcutHint.js'
import { Spinner } from '../Spinner.js'
import { CapabilitiesSection } from './CapabilitiesSection.js'
import type { HTTPServerInfo, SSEServerInfo } from './types.js'
import {
  handleReconnectError,
  handleReconnectResult,
} from './utils/reconnectHelpers.js'

type Props = {
  server: SSEServerInfo | HTTPServerInfo
  serverToolsCount: number
  onViewTools: () => void
  onCancel: () => void
  onComplete?: (
    result?: string,
    options?: { display?: CommandResultDisplay },
  ) => void
  borderless?: boolean
}

export function MCPRemoteServerMenu({
  server,
  serverToolsCount,
  onViewTools,
  onCancel,
  onComplete,
  borderless = false,
}: Props): React.ReactNode {
  const [theme] = useTheme()
  const exitState = useExitOnCtrlCDWithKeybindings()
  const mcp = useAppState(state => state.mcp)
  const setAppState = useSetAppState()
  const reconnectMcpServer = useMcpReconnect()
  const toggleMcpServer = useMcpToggleEnabled()
  const [isAuthenticating, setIsAuthenticating] = useState(false)
  const [isReconnecting, setIsReconnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null)
  const [urlCopied, setUrlCopied] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(
    () => () => {
      abortControllerRef.current?.abort()
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current)
      }
    },
    [],
  )

  useInput(input => {
    if (input !== 'c' || !authorizationUrl || urlCopied) return
    void setClipboard(authorizationUrl).then(raw => {
      if (raw) process.stdout.write(raw)
      setUrlCopied(true)
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
      copyTimeoutRef.current = setTimeout(setUrlCopied, 2000, false)
    })
  })

  const isAuthenticated =
    server.isAuthenticated ||
    (server.client.type === 'connected' && serverToolsCount > 0)
  const serverCommandsCount = filterMcpPromptsByServer(
    mcp.commands,
    server.name,
  ).length

  const reconnect = async (): Promise<void> => {
    setIsReconnecting(true)
    try {
      const result = await reconnectMcpServer(server.name)
      onComplete?.(handleReconnectResult(result, server.name).message)
    } catch (err) {
      onComplete?.(handleReconnectError(err, server.name))
    } finally {
      setIsReconnecting(false)
    }
  }

  const authenticate = async (): Promise<void> => {
    setIsAuthenticating(true)
    setError(null)
    const controller = new AbortController()
    abortControllerRef.current = controller
    try {
      if (server.isAuthenticated) {
        await revokeServerTokens(server.name, server.config, {
          preserveStepUpState: true,
        })
      }
      await performMCPOAuthFlow(
        server.name,
        server.config,
        setAuthorizationUrl,
        controller.signal,
      )
      const result = await reconnectMcpServer(server.name)
      if (result.client.type === 'connected') {
        onComplete?.(`Authentication successful. Connected to ${server.name}.`)
      } else {
        onComplete?.(
          `Authentication completed, but ${server.name} did not reconnect. Restart Leviathan if the server requires a fresh connection.`,
        )
      }
    } catch (err) {
      if (
        err instanceof Error &&
        !(err instanceof AuthenticationCancelledError)
      ) {
        setError(err.message)
      }
    } finally {
      abortControllerRef.current = null
      setAuthorizationUrl(null)
      setIsAuthenticating(false)
    }
  }

  const clearAuthentication = async (): Promise<void> => {
    await revokeServerTokens(server.name, server.config)
    await clearServerCache(server.name, {
      ...server.config,
      scope: server.scope,
    })
    setAppState(previous => ({
      ...previous,
      mcp: {
        ...previous.mcp,
        clients: previous.mcp.clients.map(client =>
          client.name === server.name ? { ...client, type: 'failed' as const } : client,
        ),
        tools: excludeToolsByServer(previous.mcp.tools, server.name),
        commands: excludeCommandsByServer(previous.mcp.commands, server.name),
        resources: excludeResourcesByServer(previous.mcp.resources, server.name),
      },
    }))
    onComplete?.(`Authentication cleared for ${server.name}.`)
  }

  const toggleEnabled = async (): Promise<void> => {
    const action = server.client.type === 'disabled' ? 'enable' : 'disable'
    try {
      await toggleMcpServer(server.name)
      onCancel()
    } catch (err) {
      onComplete?.(
        `Failed to ${action} MCP server '${server.name}': ${errorMessage(err)}`,
      )
    }
  }

  if (isAuthenticating) {
    return (
      <Box flexDirection="column" gap={1} padding={1}>
        <Text>Authenticating with {server.name}...</Text>
        <Box>
          <Spinner />
          <Text> Waiting for the configured MCP authorization flow</Text>
        </Box>
        {authorizationUrl && (
          <Box flexDirection="column">
            <Text dimColor>
              Open this URL if your browser did not open automatically. Press c
              to copy it.
            </Text>
            <Link url={authorizationUrl} />
            {urlCopied && <Text color="success">Copied.</Text>}
          </Box>
        )}
      </Box>
    )
  }

  if (isReconnecting) {
    return (
      <Box flexDirection="column" gap={1} padding={1}>
        <Text>Connecting to {server.name}...</Text>
        <Spinner />
      </Box>
    )
  }

  const menuOptions: Array<{ label: string; value: string }> = []
  if (server.client.type === 'connected' && serverToolsCount > 0) {
    menuOptions.push({ label: 'View tools', value: 'tools' })
  }
  if (isAuthenticated) {
    menuOptions.push({ label: 'Re-authenticate', value: 'authenticate' })
    menuOptions.push({
      label: 'Clear authentication',
      value: 'clear-authentication',
    })
  } else if (server.client.type !== 'disabled') {
    menuOptions.push({ label: 'Authenticate', value: 'authenticate' })
  }
  if (server.client.type !== 'disabled') {
    menuOptions.push({ label: 'Reconnect', value: 'reconnect' })
  }
  menuOptions.push({
    label: server.client.type === 'disabled' ? 'Enable' : 'Disable',
    value: 'toggle',
  })

  return (
    <Box flexDirection="column">
      <Box
        flexDirection="column"
        paddingX={1}
        borderStyle={borderless ? undefined : 'round'}
      >
        <Box marginBottom={1}>
          <Text bold>{capitalize(String(server.name))} MCP Server</Text>
        </Box>
        <Box>
          <Text bold>Status: </Text>
          {server.client.type === 'disabled' ? (
            <Text>{color('inactive', theme)(figures.radioOff)} disabled</Text>
          ) : server.client.type === 'connected' ? (
            <Text>{color('success', theme)(figures.tick)} connected</Text>
          ) : (
            <Text>{color('error', theme)(figures.cross)} not connected</Text>
          )}
        </Box>
        <Box>
          <Text bold>Auth: </Text>
          <Text>
            {isAuthenticated
              ? `${color('success', theme)(figures.tick)} authenticated`
              : `${color('error', theme)(figures.cross)} not authenticated`}
          </Text>
        </Box>
        <Box>
          <Text bold>URL: </Text>
          <Text dimColor>{server.config.url}</Text>
        </Box>
        <Box>
          <Text bold>Config location: </Text>
          <Text dimColor>{describeMcpConfigFilePath(server.scope)}</Text>
        </Box>
        {server.client.type === 'connected' && (
          <CapabilitiesSection
            serverToolsCount={serverToolsCount}
            serverPromptsCount={serverCommandsCount}
            serverResourcesCount={mcp.resources[server.name]?.length || 0}
          />
        )}
        {error && (
          <Box marginTop={1}>
            <Text color="error">Error: {error}</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Select
            options={menuOptions}
            onChange={async value => {
              switch (value) {
                case 'tools':
                  onViewTools()
                  break
                case 'authenticate':
                  await authenticate()
                  break
                case 'clear-authentication':
                  await clearAuthentication()
                  break
                case 'reconnect':
                  await reconnect()
                  break
                case 'toggle':
                  await toggleEnabled()
                  break
              }
            }}
            onCancel={onCancel}
          />
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text dimColor italic>
          {exitState.pending ? (
            <>Press {exitState.keyName} again to exit</>
          ) : (
            <Byline>
              <KeyboardShortcutHint shortcut="Up/Down" action="navigate" />
              <KeyboardShortcutHint shortcut="Enter" action="select" />
              <ConfigurableShortcutHint
                action="confirm:no"
                context="Confirmation"
                fallback="Esc"
                description="back"
              />
            </Byline>
          )}
        </Text>
      </Box>
    </Box>
  )
}
