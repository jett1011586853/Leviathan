import React from 'react'
import { Text } from '../../ink.js'

export function getUserFacingName(_input: unknown): string {
  return 'Update'
}

export function getToolUseSummary(_input: unknown): string {
  return ''
}

export function renderToolUseMessage(): React.ReactElement {
  return React.createElement(Text, {}, 'Tungsten edit')
}

export function renderToolUseRejectedMessage(): React.ReactElement {
  return React.createElement(Text, {}, 'Edit rejected')
}

export function renderToolUseErrorMessage(): React.ReactElement {
  return React.createElement(Text, {}, 'Edit error')
}

export function renderToolResultMessage(): React.ReactElement | null {
  return null
}
