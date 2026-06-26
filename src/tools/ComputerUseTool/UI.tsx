import * as React from 'react'
import { MessageResponse } from '../../components/MessageResponse.js'
import { OutputLine } from '../../components/shell/OutputLine.js'
import { Box, Text } from '../../ink.js'
import type { ComputerUseInput, ComputerUseOutput } from './windowsComputerUse.js'

export function getToolUseSummary(
  input: Partial<ComputerUseInput> | undefined,
): string | null {
  if (!input?.action) return null
  if (
    (input.action === 'screenshot' || input.action === 'get_window_state') &&
    input.hwnd
  ) {
    return `${input.action} ${input.hwnd}`
  }
  if (input.action === 'sequence') {
    return `sequence ${input.steps?.length ?? 0} steps`
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

  if (output.state?.screenshots[0]) {
    const screenshot = output.state.screenshots[0]
    return (
      <MessageResponse height={1}>
        <Text dimColor>
          Window state captured and sent to Leviathan ({screenshot.width}x
          {screenshot.height}
          {screenshot.scale < 1
            ? `, scaled from ${screenshot.originalWidth}x${screenshot.originalHeight}`
            : ''}
          {output.latencyMs !== undefined ? `, ${output.latencyMs} ms` : ''})
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
  const suffix =
    output.latencyMs !== undefined ? ` (${output.latencyMs} ms)` : ''
  if (output.apps) {
    const rows = output.apps.flatMap(app =>
      app.windows.map(window => {
        const bounds = `${window.bounds.x},${window.bounds.y} ${window.bounds.width}x${window.bounds.height}`
        const blocked = window.blockedReason ? ` [blocked: ${window.blockedReason}]` : ''
        return `${app.displayName}  ${window.hwnd}  ${bounds}  ${window.title}${blocked}`
      }),
    )
    return rows.length
      ? `Running apps${suffix}:\n${rows.join('\n')}`
      : `No running apps with visible windows found${suffix}.`
  }
  if (output.windows) {
    const rows = output.windows.map(window => {
      const bounds = `${window.bounds.x},${window.bounds.y} ${window.bounds.width}x${window.bounds.height}`
      const blocked = window.blockedReason ? ` [blocked: ${window.blockedReason}]` : ''
      return `${window.hwnd}  ${window.processName}  ${bounds}  ${window.title}${blocked}`
    })
    return rows.length
      ? `Visible windows${suffix}:\n${rows.join('\n')}`
      : `No visible windows found${suffix}.`
  }
  if (output.steps) {
    return `${output.message}${suffix}\n${output.steps
      .map((step, index) => `${index + 1}. ${step.action}: ${step.message}`)
      .join('\n')}`
  }
  if (output.window) {
    const window = output.window
    return `${output.message}${suffix}\n${window.hwnd} ${window.processName} ${window.title}`
  }
  return `${output.message}${suffix}`
}
