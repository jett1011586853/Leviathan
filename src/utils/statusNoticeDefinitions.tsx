import figures from 'figures'
import { relative } from 'path'
import * as React from 'react'
import type { AgentDefinitionsResult } from '../tools/AgentTool/loadAgentsDir.js'
import { Box, Text } from '../ink.js'
import type { getGlobalConfig } from './config.js'
import { getCwd } from './cwd.js'
import { formatNumber } from './format.js'
import {
  getLargeMemoryFiles,
  MAX_MEMORY_CHARACTER_COUNT,
  type MemoryFileInfo,
} from './leviathanmd.js'
import {
  AGENT_DESCRIPTIONS_THRESHOLD,
  getAgentDescriptionsTotalTokens,
} from './statusNoticeHelpers.js'

export type StatusNoticeType = 'warning' | 'info'

export type StatusNoticeContext = {
  config: ReturnType<typeof getGlobalConfig>
  agentDefinitions?: AgentDefinitionsResult
  memoryFiles: MemoryFileInfo[]
}

export type StatusNoticeDefinition = {
  id: string
  type: StatusNoticeType
  isActive: (context: StatusNoticeContext) => boolean
  render: (context: StatusNoticeContext) => React.ReactNode
}

const largeMemoryFilesNotice: StatusNoticeDefinition = {
  id: 'large-memory-files',
  type: 'warning',
  isActive: ctx => getLargeMemoryFiles(ctx.memoryFiles).length > 0,
  render: ctx => {
    const largeMemoryFiles = getLargeMemoryFiles(ctx.memoryFiles)
    return (
      <>
        {largeMemoryFiles.map(file => {
          const displayPath = file.path.startsWith(getCwd())
            ? relative(getCwd(), file.path)
            : file.path
          return (
            <Box key={file.path} flexDirection="row">
              <Text color="warning">{figures.warning}</Text>
              <Text color="warning">
                Large <Text bold>{displayPath}</Text> will impact performance (
                {formatNumber(file.content.length)} chars &gt;{' '}
                {formatNumber(MAX_MEMORY_CHARACTER_COUNT)})
                <Text dimColor> · /memory to edit</Text>
              </Text>
            </Box>
          )
        })}
      </>
    )
  },
}

const largeAgentDescriptionsNotice: StatusNoticeDefinition = {
  id: 'large-agent-descriptions',
  type: 'warning',
  isActive: context =>
    getAgentDescriptionsTotalTokens(context.agentDefinitions) >
    AGENT_DESCRIPTIONS_THRESHOLD,
  render: context => {
    const totalTokens = getAgentDescriptionsTotalTokens(
      context.agentDefinitions,
    )
    return (
      <Box flexDirection="row">
        <Text color="warning">{figures.warning}</Text>
        <Text color="warning">
          Large cumulative agent descriptions will impact performance (~
          {formatNumber(totalTokens)} tokens &gt;{' '}
          {formatNumber(AGENT_DESCRIPTIONS_THRESHOLD)})
          <Text dimColor> · /agents to manage</Text>
        </Text>
      </Box>
    )
  },
}

export const statusNoticeDefinitions: StatusNoticeDefinition[] = [
  largeMemoryFilesNotice,
  largeAgentDescriptionsNotice,
]

export function getActiveNotices(
  context: StatusNoticeContext,
): StatusNoticeDefinition[] {
  return statusNoticeDefinitions.filter(notice => notice.isActive(context))
}
