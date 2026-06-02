import React from 'react'
import { Box, Text } from '../../ink.js'
import { PRODUCT_NAME } from '../../leviathan/branding.js'
import { LeviathanWhale } from './LeviathanWhale.js'

export function WelcomeV2(): React.ReactNode {
  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Text>
        <Text bold color="leviathan">
          {PRODUCT_NAME}
        </Text>
        <Text dimColor> v{MACRO.VERSION}</Text>
      </Text>
      <LeviathanWhale />
    </Box>
  )
}
