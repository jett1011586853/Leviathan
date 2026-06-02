import type React from 'react'
import type { CommandResultDisplay } from '../../commands.js'
import { Box, Text } from '../../ink.js'
import { Pane } from '../design-system/Pane.js'

type Props = {
  onDone: (
    result?: string,
    options?: { display?: CommandResultDisplay },
  ) => void
}

export function Passes({ onDone: _onDone }: Props): React.ReactNode {
  return (
    <Pane>
      <Box flexDirection="column" gap={1}>
        <Text>Leviathan sharing passes are not currently available.</Text>
      </Box>
    </Pane>
  )
}
