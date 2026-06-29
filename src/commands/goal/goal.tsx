import React, { useState } from 'react'
import { Box, Text } from '../../ink.js'
import TextInput from '../../components/TextInput.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import type {
  LocalJSXCommandContext,
  LocalJSXCommandOnDone,
} from '../../types/command.js'
import { useTerminalSize } from '../../hooks/useTerminalSize.js'

const EMPTY_GOAL_MESSAGE = 'Goal mode cancelled: no objective was provided.'

function buildGoalModePrompt(goal: string): string {
  return [
    '<goal_mode>',
    'You are now in Leviathan Goal Mode.',
    '',
    `Final goal: ${goal}`,
    '',
    'Work continuously toward this goal until it is achieved or you are genuinely blocked.',
    'Do not stop at a proposal if implementation or verification can be done with the available tools.',
    'First restate the goal in operational terms, then create a concise plan, then execute the plan step by step.',
    'Use Todo/Plan when useful, inspect the workspace before making assumptions, and verify completed work with the most relevant commands or checks.',
    'If a step fails, diagnose the cause, retry with a better approach, or revise the plan.',
    'Ask the user only when required information, credentials, permissions, or external state are truly blocking progress.',
    'When the goal is complete, summarize what changed and what was verified.',
    '</goal_mode>',
  ].join('\n')
}

function completionMessage(goal: string): string {
  return `Goal mode started.\nObjective: ${goal}`
}

function submitGoal(
  onDone: LocalJSXCommandOnDone,
  rawGoal: string,
): void {
  const goal = rawGoal.trim()
  if (!goal) {
    onDone(EMPTY_GOAL_MESSAGE, { display: 'system' })
    return
  }

  onDone(completionMessage(goal), {
    display: 'system',
    shouldQuery: true,
    metaMessages: [buildGoalModePrompt(goal)],
  })
}

function GoalDialog({
  onDone,
}: {
  onDone: LocalJSXCommandOnDone
}): React.ReactNode {
  const terminalSize = useTerminalSize()
  const [goal, setGoal] = useState('')
  const [cursorOffset, setCursorOffset] = useState(0)
  const inputColumns = Math.max(40, Math.min(100, terminalSize.columns - 8))

  const handleSubmit = (value: string) => {
    submitGoal(onDone, value)
  }

  const handleCancel = () => {
    onDone('Goal mode cancelled.', { display: 'system' })
  }

  return (
    <Dialog
      title="Goal Mode"
      subtitle="Enter the final objective Leviathan should keep working toward."
      color="permission"
      onCancel={handleCancel}
    >
      <Box flexDirection="column" gap={1}>
        <Text>
          Describe the final state you want. Leviathan will plan, execute,
          verify, and keep iterating until the goal is achieved or blocked.
        </Text>
        <Box>
          <TextInput
            value={goal}
            onChange={setGoal}
            onSubmit={handleSubmit}
            onExit={handleCancel}
            placeholder="e.g., Fix the startup error, verify tests, and prepare a release"
            columns={inputColumns}
            cursorOffset={cursorOffset}
            onChangeCursorOffset={setCursorOffset}
            focus
            showCursor
            multiline={false}
          />
        </Box>
      </Box>
    </Dialog>
  )
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: LocalJSXCommandContext,
  args?: string,
): Promise<React.ReactNode | null> {
  const directGoal = (args ?? '').trim()
  if (directGoal) {
    submitGoal(onDone, directGoal)
    return null
  }

  return <GoalDialog onDone={onDone} />
}
