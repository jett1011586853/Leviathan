import * as React from 'react'
import type { LocalJSXCommandContext } from '../../commands.js'
import { Box, Text } from '../../ink.js'
import { ACCOUNT_LOGIN_STATUS } from '../../leviathan/branding.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'

export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: LocalJSXCommandContext,
): Promise<React.ReactNode> {
  onDone(ACCOUNT_LOGIN_STATUS, { display: 'system' })
  return null
}

type Props = {
  onDone: (success: boolean, mainLoopModel: string) => void
  startingMessage?: string
}

export function Login(_props: Props): React.ReactNode {
  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Text>{ACCOUNT_LOGIN_STATUS}</Text>
    </Box>
  )
}
