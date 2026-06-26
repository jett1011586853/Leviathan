import * as React from 'react'
import { MessageResponse } from '../../components/MessageResponse.js'
import { OutputLine } from '../../components/shell/OutputLine.js'
import { Box, Text } from '../../ink.js'
import type { ComputerUseInput, ComputerUseOutput } from './windowsComputerUse.js'

export function getToolUseSummary(
  input: Partial<ComputerUseInput> | undefined,
): string | null {
  if (!input?.action) return null
  if (input.action === 'screenshot' && input.hwnd) {
    return `screenshot ${input.hwnd}`
  }
  if (
    ['click', 'double_click', 'right_click', 'scroll'].includes(input.action) &&
    input.x !== undefined &&
    input.y !== undefined
  ) {
    return `${input.action} ${input.x},${input.y}`
  }
  return input.action
}

export function renderToolUseMessage(
  input: Partial<ComputerUseInput>,
): React.ReactNode {
  const summary = getToolUseSummary(input)
  return summary ? <Text>Computer Use: {summary}</Text> : null
}

export function renderToolResultMessage(
  output: ComputerUseOutput,
  _progressMessages: unknown[],
  { verbose }: { verbose: boolean },
): React.ReactNode {
  if (output.screenshot) {
    return (
      <MessageResponse height={1}>
        <Text dimColor>
          Screenshot captured and sent to Leviathan (
          {output.screenshot.width}x{output.screenshot.height}
          {output.screenshot.scale < 1
            ? `, scaled from ${output.screenshot.originalWidth}x${output.screenshot.originalHeight}`
            : ''}
          )
        </Text>
      </MessageResponse>
    )
  }

  return (
    <Box flexDirection="column">
      <OutputLine content={summarizeOutput(output)} verbose={verbose} />
    </Box>
  )
}

function summarizeOutput(output: ComputerUseOutput): string {
  if (output.windows) {
    const rows = output.windows.map(window => {
      const bounds = `${window.bounds.x},${window.bounds.y} ${window.bounds.width}x${window.bounds.height}`
      const blocked = window.blockedReason ? ` [blocked: ${window.blockedReason}]` : ''
      return `${window.hwnd}  ${window.processName}  ${bounds}  ${window.title}${blocked}`
    })
    return rows.length
      ? `Visible windows:\n${rows.join('\n')}`
      : 'No visible windows found.'
  }
  if (output.window) {
    const window = output.window
    return `${output.message}\n${window.hwnd} ${window.processName} ${window.title}`
  }
  return output.message
}
