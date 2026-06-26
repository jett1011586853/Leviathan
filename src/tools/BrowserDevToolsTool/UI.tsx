import * as React from 'react'
import { MessageResponse } from '../../components/MessageResponse.js'
import { OutputLine } from '../../components/shell/OutputLine.js'
import { Box, Text } from '../../ink.js'
import type {
  BrowserDevToolsInput,
  BrowserDevToolsOutput,
} from './browserDevTools.js'

export function getToolUseSummary(
  input: Partial<BrowserDevToolsInput> | undefined,
): string | null {
  if (!input?.action) return null
  if (input.action === 'navigate' && input.url) return `navigate ${input.url}`
  if (input.action === 'evaluate') return 'evaluate JavaScript'
  if (input.selector) return `${input.action} ${input.selector}`
  if (input.tab_id) return `${input.action} ${input.tab_id}`
  return input.action
}

export function renderToolUseMessage(
  input: Partial<BrowserDevToolsInput>,
): React.ReactNode {
  const summary = getToolUseSummary(input)
  return summary ? <Text>Browser DevTools: {summary}</Text> : null
}

export function renderToolResultMessage(
  output: BrowserDevToolsOutput,
  _progressMessages: unknown[],
  { verbose }: { verbose: boolean },
): React.ReactNode {
  if (output.screenshot) {
    return (
      <MessageResponse height={1}>
        <Text dimColor>Browser screenshot captured and sent to Leviathan</Text>
      </MessageResponse>
    )
  }

  return (
    <Box flexDirection="column">
      <OutputLine content={summarizeOutput(output)} verbose={verbose} />
    </Box>
  )
}

function summarizeOutput(output: BrowserDevToolsOutput): string {
  if (output.tabs) {
    return output.tabs.length
      ? `Browser tabs:\n${output.tabs
          .map(tab => `${tab.id}  ${tab.type}  ${tab.title}  ${tab.url}`)
          .join('\n')}`
      : 'No Browser DevTools tabs found.'
  }
  if (output.snapshot) {
    return [
      output.message,
      `${output.snapshot.title}  ${output.snapshot.url}`,
      `Visible controls: ${output.snapshot.elements.length}`,
    ].join('\n')
  }
  if (output.tab) {
    return `${output.message}\n${output.tab.id} ${output.tab.title} ${output.tab.url}`
  }
  return output.message
}
