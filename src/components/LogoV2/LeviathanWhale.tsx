import React from 'react'
import { Box, Text } from '../../ink.js'
import { LEVIATHAN_PIXEL_WHALE } from '../../leviathan/branding.js'

export function LeviathanWhale(): React.ReactNode {
  return (
    <Box flexDirection="column" flexShrink={0}>
      {LEVIATHAN_PIXEL_WHALE.map((line, index) => (
        <Text key={index} color="leviathan">
          {line}
        </Text>
      ))}
    </Box>
  )
}
