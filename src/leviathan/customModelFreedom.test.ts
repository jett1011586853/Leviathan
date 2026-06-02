import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

function source(relativePath: string): string {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8').split(
    '//# sourceMappingURL=',
    1,
  )[0]
}

describe('Leviathan custom model freedom', () => {
  test('user-specified models pass through without local allowlist blocking', () => {
    const model = source('utils/model/model.ts')
    const allowlist = source('utils/model/modelAllowlist.ts')

    expect(model).toContain('custom Anthropic-compatible gateways')
    expect(model).toContain('process.env.ANTHROPIC_MODEL ||')
    expect(model).toContain("DEFAULT_LEVIATHAN_MODEL: ModelName = 'mimo-v2.5'")
    expect(model).toContain('process.env.LEVIATHAN_DEFAULT_MODEL || DEFAULT_LEVIATHAN_MODEL')
    expect(model).toContain('return getLeviathanDefaultModel()')
    expect(model).not.toContain('!isModelAllowed(specifiedModel)')
    expect(allowlist).toContain('return true')
  })

  test('/model accepts arbitrary provider model IDs without remote validation', () => {
    const command = source('commands/model/model.tsx')
    const validator = source('utils/model/validateModel.ts')

    expect(command).toContain('setModel(model);')
    expect(command).toContain('mimo-v2.5')
    expect(command).not.toContain('validateModel(model)')
    expect(command).not.toContain("Model '${model}' is not available")
    expect(validator).not.toContain('sideQuery')
    expect(validator).not.toContain('model_validation')
    expect(validator).toContain('return { valid: true }')
  })

  test('agent and config schemas advertise provider model IDs instead of Claude families', () => {
    const agentTool = source('tools/AgentTool/AgentTool.tsx')
    const configPrompt = source('tools/ConfigTool/prompt.ts')
    const supportedSettings = source('tools/ConfigTool/supportedSettings.ts')

    expect(agentTool).toContain('model: z.string().optional()')
    expect(agentTool).toContain('mimo-v2.5')
    expect(configPrompt).toContain('"mimo-v2.5"')
    expect(configPrompt).not.toContain('"value": "opus"')
    expect(supportedSettings).not.toContain('validateModel')
    expect(supportedSettings).not.toContain('validateOnWrite: v =>')
    expect(supportedSettings).toContain('any provider-supported model ID')
  })

  test('built-in agents inherit the user configured model by default', () => {
    const builtIns = [
      source('tools/AgentTool/built-in/leviathanGuideAgent.ts'),
      source('tools/AgentTool/built-in/exploreAgent.ts'),
      source('tools/AgentTool/built-in/statuslineSetup.ts'),
      source('services/MagicDocs/magicDocs.ts'),
    ].join('\n')

    expect(builtIns).not.toContain("model: 'haiku'")
    expect(builtIns).not.toContain("model: 'sonnet'")
    expect(builtIns).toContain("model: 'inherit'")
  })

  test('bearer-token provider auth is documented and accepted in bare mode', () => {
    const main = source('main.tsx')
    const auth = source('utils/auth.ts')
    const client = source('services/api/client.ts')
    const envUtils = source('utils/envUtils.ts')
    const http = source('utils/http.ts')
    const analyticsMetadata = source('services/analytics/metadata.ts')
    const apiClaude = source('services/api/claude.ts')
    const betas = source('utils/betas.ts')
    const envExample = source('../.env.example')
    const settingsConfig = source('components/Settings/Config.tsx')
    const approveApiKey = source('components/ApproveApiKey.tsx')
    const config = source('utils/config.ts')
    const settingsTypes = source('utils/settings/types.ts')
    const authHandler = source('cli/handlers/auth.ts')
    const consoleOAuthFlow = source('components/ConsoleOAuthFlow.tsx')

    expect(main).toContain('ANTHROPIC_AUTH_TOKEN')
    expect(main).not.toContain('--claudeai')
    expect(main).not.toContain("connectMcpBatch(dedupedManagedMcp, 'claudeai')")
    expect(main).toContain("connectMcpBatch(dedupedManagedMcp, 'managed')")
    expect(main).toContain("'leviathan-desktop'")
    expect(main).not.toContain("'claude-desktop'")
    expect(main).not.toContain('Anthropic API auth is strictly ANTHROPIC_API_KEY or apiKeyHelper')
    expect(auth).toContain('process.env.ANTHROPIC_AUTH_TOKEN')
    expect(auth).toContain('if (apiKeyEnv && !isManagedOAuthContext())')
    expect(auth).toContain('if (!apiKeyEnv && process.env.ANTHROPIC_AUTH_TOKEN)')
    expect(auth).not.toContain('normalizeApiKeyForConfig(apiKeyEnv)')
    expect(client).toContain('authToken: process.env.ANTHROPIC_AUTH_TOKEN || null')
    expect(client).toContain('baseURL: process.env.ANTHROPIC_BASE_URL')
    expect(client).toContain('process.env.LEVIATHAN_AGENT_SDK_CLIENT_APP')
    expect(client).toContain("'X-Leviathan-Code-Session-Id'")
    expect(client).not.toContain('process.env.CLAUDE_AGENT_SDK_CLIENT_APP')
    expect(client).not.toContain("'X-Claude-Code-Session-Id'")
    expect(client).toContain(
      'const token = await getApiKeyFromApiKeyHelper(isNonInteractiveSession)',
    )
    expect(client).toContain("headers['Authorization'] = `Bearer ${token}`")
    expect(http).toContain('process.env.LEVIATHAN_AGENT_SDK_VERSION')
    expect(http).toContain('process.env.LEVIATHAN_AGENT_SDK_CLIENT_APP')
    expect(http).not.toContain('process.env.CLAUDE_AGENT_SDK_VERSION')
    expect(http).not.toContain('process.env.CLAUDE_AGENT_SDK_CLIENT_APP')
    expect(analyticsMetadata).toContain('process.env.LEVIATHAN_AGENT_SDK_VERSION')
    expect(analyticsMetadata).not.toContain('process.env.CLAUDE_AGENT_SDK_VERSION')
    expect(betas).toContain('shouldIncludeLeviathanCodeBeta')
    expect(betas).toContain('process.env.ANTHROPIC_BASE_URL')
    expect(betas).toContain('process.env.LEVIATHAN_CODE_ENABLE_PROVIDER_BETAS')
    expect(betas).toContain('process.env.LEVIATHAN_CODE_DISABLE_AUTO_BETAS')
    expect(betas).toContain('!isHaiku && shouldIncludeLeviathanCodeBeta()')
    expect(betas).toContain(
      'options?.isAgenticQuery && shouldIncludeLeviathanCodeBeta()',
    )
    expect(betas).toContain('process.env.ANTHROPIC_BETAS')
    expect(apiClaude).toContain('return apiKey.trim().length > 0')
    expect(apiClaude).not.toContain("source: 'verify_api_key'")
    expect(apiClaude).not.toContain('API key verification')
    expect(envExample).toContain('ANTHROPIC_BASE_URL=https://token-plan-cn.example.com/anthropic')
    expect(envExample).toContain('ANTHROPIC_AUTH_TOKEN=your-provider-token')
    expect(envExample).toContain('ANTHROPIC_MODEL=mimo-v2.5')
    expect(envExample).toContain('LEVIATHAN_CODE_ENABLE_PROVIDER_BETAS=true')
    expect(envUtils).toContain('ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or apiKeyHelper')
    expect(settingsConfig).not.toContain('normalizeApiKeyForConfig')
    expect(settingsConfig).not.toContain('Use custom API key')
    expect(approveApiKey).toContain('onDone(true)')
    expect(approveApiKey).not.toContain('customApiKeyResponses')
    expect(config).toContain("return truncatedApiKey.trim().length > 0 ? 'approved' : 'new'")
    expect(config).not.toContain('customApiKeyResponses')
    expect(config).not.toContain("customApiKeyResponses?.rejected?.includes(truncatedApiKey)")
    expect(settingsTypes).toContain('forceLoginMethod: z')
    expect(settingsTypes).toContain('.string()')
    expect(settingsTypes).not.toContain(".enum(['claudeai', 'console'])")
    expect(authHandler).not.toContain('claudeai?: boolean')
    expect(consoleOAuthFlow).toContain('forceLoginMethod?: string')
  })

  test('system prompt respects configured provider models instead of recommending Claude defaults', () => {
    const prompts = source('constants/prompts.ts')

    expect(prompts).toContain('Leviathan uses the model and endpoint configured by the user')
    expect(prompts).toContain('use exact model IDs supplied by that provider')
    expect(prompts).not.toContain('The most recent Claude model family')
    expect(prompts).not.toContain('default to the latest and most capable Claude models')
    expect(prompts).not.toContain("const FRONTIER_MODEL_NAME = 'Claude")
  })
})
