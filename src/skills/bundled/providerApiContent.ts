// Content for the provider-api bundled skill.
// Each .md file is inlined as a string at build time via Bun's text loader.

import csharpProviderApi from './provider-api/csharp/provider-api.md'
import curlExamples from './provider-api/curl/examples.md'
import goProviderApi from './provider-api/go/provider-api.md'
import javaProviderApi from './provider-api/java/provider-api.md'
import phpProviderApi from './provider-api/php/provider-api.md'
import pythonAgentSdkPatterns from './provider-api/python/agent-sdk/patterns.md'
import pythonAgentSdkReadme from './provider-api/python/agent-sdk/README.md'
import pythonProviderApiBatches from './provider-api/python/provider-api/batches.md'
import pythonProviderApiFilesApi from './provider-api/python/provider-api/files-api.md'
import pythonProviderApiReadme from './provider-api/python/provider-api/README.md'
import pythonProviderApiStreaming from './provider-api/python/provider-api/streaming.md'
import pythonProviderApiToolUse from './provider-api/python/provider-api/tool-use.md'
import rubyProviderApi from './provider-api/ruby/provider-api.md'
import skillPrompt from './provider-api/SKILL.md'
import sharedErrorCodes from './provider-api/shared/error-codes.md'
import sharedLiveSources from './provider-api/shared/live-sources.md'
import sharedModels from './provider-api/shared/models.md'
import sharedPromptCaching from './provider-api/shared/prompt-caching.md'
import sharedToolUseConcepts from './provider-api/shared/tool-use-concepts.md'
import typescriptAgentSdkPatterns from './provider-api/typescript/agent-sdk/patterns.md'
import typescriptAgentSdkReadme from './provider-api/typescript/agent-sdk/README.md'
import typescriptProviderApiBatches from './provider-api/typescript/provider-api/batches.md'
import typescriptProviderApiFilesApi from './provider-api/typescript/provider-api/files-api.md'
import typescriptProviderApiReadme from './provider-api/typescript/provider-api/README.md'
import typescriptProviderApiStreaming from './provider-api/typescript/provider-api/streaming.md'
import typescriptProviderApiToolUse from './provider-api/typescript/provider-api/tool-use.md'

// Provider-neutral placeholders are substituted into {{VAR}} in the docs. Users
// should pass exact model IDs from their configured endpoint at runtime.
export const SKILL_MODEL_VARS = {
  OPUS_ID: 'provider-advanced-model',
  OPUS_NAME: 'Configured advanced provider model',
  SONNET_ID: 'provider-balanced-model',
  SONNET_NAME: 'Configured balanced provider model',
  HAIKU_ID: 'provider-fast-model',
  HAIKU_NAME: 'Configured fast provider model',
  PREV_SONNET_ID: 'provider-previous-balanced-model',
} satisfies Record<string, string>

export const SKILL_PROMPT: string = skillPrompt

export const SKILL_FILES: Record<string, string> = {
  'csharp/provider-api.md': csharpProviderApi,
  'curl/examples.md': curlExamples,
  'go/provider-api.md': goProviderApi,
  'java/provider-api.md': javaProviderApi,
  'php/provider-api.md': phpProviderApi,
  'python/agent-sdk/README.md': pythonAgentSdkReadme,
  'python/agent-sdk/patterns.md': pythonAgentSdkPatterns,
  'python/provider-api/README.md': pythonProviderApiReadme,
  'python/provider-api/batches.md': pythonProviderApiBatches,
  'python/provider-api/files-api.md': pythonProviderApiFilesApi,
  'python/provider-api/streaming.md': pythonProviderApiStreaming,
  'python/provider-api/tool-use.md': pythonProviderApiToolUse,
  'ruby/provider-api.md': rubyProviderApi,
  'shared/error-codes.md': sharedErrorCodes,
  'shared/live-sources.md': sharedLiveSources,
  'shared/models.md': sharedModels,
  'shared/prompt-caching.md': sharedPromptCaching,
  'shared/tool-use-concepts.md': sharedToolUseConcepts,
  'typescript/agent-sdk/README.md': typescriptAgentSdkReadme,
  'typescript/agent-sdk/patterns.md': typescriptAgentSdkPatterns,
  'typescript/provider-api/README.md': typescriptProviderApiReadme,
  'typescript/provider-api/batches.md': typescriptProviderApiBatches,
  'typescript/provider-api/files-api.md': typescriptProviderApiFilesApi,
  'typescript/provider-api/streaming.md': typescriptProviderApiStreaming,
  'typescript/provider-api/tool-use.md': typescriptProviderApiToolUse,
}
