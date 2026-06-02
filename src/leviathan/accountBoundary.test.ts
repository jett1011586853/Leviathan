import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

function source(relativePath: string): string {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8').split(
    '//# sourceMappingURL=',
    1,
  )[0]
}

describe('Leviathan product account boundary', () => {
  test('authentication helpers cannot activate stored product-account OAuth', () => {
    const auth = source('utils/auth.ts')
    const tokenSource = auth.slice(
      auth.indexOf('export function getAuthTokenSource'),
      auth.indexOf('export type ApiKeySource'),
    )
    const apiKeySource = auth.slice(
      auth.indexOf('export function getAnthropicApiKeyWithSource'),
      auth.indexOf('export function getConfiguredApiKeyHelper'),
    )

    expect(auth).toContain(
      'export function isAnthropicAuthEnabled(): boolean {\n  return false\n}',
    )
    expect(auth).toContain(
      'export const getLegacyAccountOAuthTokens = memoize((): OAuthTokens | null => {\n  return null\n})',
    )
    expect(auth).toContain(
      'export async function getLegacyAccountOAuthTokensAsync(): Promise<OAuthTokens | null> {\n  return null\n}',
    )
    expect(tokenSource).not.toContain('process.env.LEVIATHAN_CODE_OAUTH_TOKEN')
    expect(tokenSource).not.toContain('getOAuthTokenFromFileDescriptor()')
    expect(tokenSource).not.toContain('getClaudeAIOAuthTokens()')
    expect(apiKeySource).not.toContain('process.env.LEVIATHAN_CODE_OAUTH_TOKEN')
    expect(apiKeySource).not.toContain('or LEVIATHAN_CODE_OAUTH_TOKEN')
  })

  test('startup does not prefetch consumer account entitlements', () => {
    const main = source('main.tsx')

    expect(main).not.toContain('checkQuotaStatus')
    expect(main).not.toContain('prefetchPassesEligibility')
  })

  test('normal initialization never fills recovered product OAuth account data', () => {
    const init = source('entrypoints/init.ts')

    expect(init).not.toContain('populateOAuthAccountInfoIfNeeded')
    expect(init).not.toContain('../services/oauth/client.js')
  })

  test('startup does not sync settings or prefetch recovered product API data', () => {
    const main = source('main.tsx')

    expect(main).not.toContain('uploadUserSettingsInBackground')
    expect(main).not.toContain('fetchBootstrapData')
    expect(main).not.toContain('prefetchFastModeStatus')
  })

  test('privacy settings command cannot contact recovered account services', () => {
    const index = source('commands/privacy-settings/index.ts')
    const command = source('commands/privacy-settings/privacy-settings.tsx')

    expect(index).not.toContain('isConsumerSubscriber')
    expect(index).toContain('isEnabled: () => false')
    expect(command).toContain('LEGACY_ACCOUNT_FEATURE_NOTICE')
    expect(command).not.toContain('services/api/grove')
    expect(command).not.toContain('claude.ai')
    expect(command).not.toContain('Help improve Claude')
  })

  test('help-registered remote control cannot execute the legacy bridge', () => {
    const main = source('main.tsx')
    const executable = main.replace(/^\s*\/\/.*$/gm, '')

    expect(main).not.toContain('bridgeMain')
    expect(executable).not.toContain('claude.ai/code')
    expect(main).not.toContain('Usage: claude assistant')
  })

  test('disabled bridge source copy is Leviathan-neutralized', () => {
    const bridge = [
      source('bridge/bridgeEnabled.ts'),
      source('bridge/envLessBridgeConfig.ts'),
      source('bridge/bridgeApi.ts'),
      source('bridge/bridgeMain.ts'),
      source('bridge/initReplBridge.ts'),
      source('bridge/bridgeStatusUtil.ts'),
      source('bridge/createSession.ts'),
      source('bridge/trustedDevice.ts'),
      source('bridge/inboundAttachments.ts'),
      source('constants/product.ts'),
    ].join('\n')

    for (const removed of [
      'version of donk',
      'Run `claude update`',
      'Claude account',
      'Claude Remote Control',
      'Claude app',
      'donk on Web',
      'claude remote-control',
      'Run `claude` first',
      'claude.ai/code',
      'code.claude.com/docs/en/remote-control',
      'run `donk update`',
      'donk on ${hostname()}',
      '~/.claude/uploads',
      'donk Remote session URLs',
      "PRODUCT_URL = 'https://claude.com/claude-code'",
    ]) {
      expect(bridge).not.toContain(removed)
    }
    expect(bridge).toContain('Leviathan')
  })

  test('interactive and print setup never show recovered account consent UI', () => {
    const interactive = source('interactiveHelpers.tsx')
    const print = source('cli/print.ts')

    expect(interactive).not.toContain('isQualifiedForGrove')
    expect(interactive).not.toContain('GroveDialog')
    expect(interactive).not.toContain('LeviathanBrowserOnboarding')
    expect(print).not.toContain('isQualifiedForGrove')
    expect(print).not.toContain('checkGroveForNonInteractive')
  })

  test('print control protocol rejects product-account OAuth locally', () => {
    const print = source('cli/print.ts')

    expect(print).not.toContain("import { OAuthService }")
    expect(print).not.toContain('installOAuthTokens')
    expect(print).not.toContain('new OAuthService()')
    expect(print).toContain("message.request.subtype === 'claude_authenticate'")
    expect(print).toContain(
      'sendControlResponseError(message, LEGACY_ACCOUNT_FEATURE_NOTICE)',
    )
  })

  test('logout never deletes provider credentials or installs account tokens', () => {
    const logout = source('commands/logout/logout.tsx')
    const logoutIndex = source('commands/logout/index.ts')
    const authHandler = source('cli/handlers/auth.ts')

    expect(logout).not.toContain('removeApiKey')
    expect(logout).not.toContain('getSecureStorage')
    expect(logout).not.toContain('getGroveSettings')
    expect(logout).toContain('ACCOUNT_LOGIN_STATUS')
    expect(logoutIndex).not.toContain('Anthropic account')
    expect(authHandler).toContain(
      'throw new Error(LEGACY_ACCOUNT_FEATURE_NOTICE)',
    )
    expect(authHandler).not.toContain('saveOAuthTokensIfNeeded')
    expect(authHandler).not.toContain('createAndStoreApiKey')
  })

  test('REPL never mounts recovered product feedback or transcript sharing', () => {
    const repl = source('screens/REPL.tsx')

    expect(repl).not.toContain("from 'src/components/FeedbackSurvey/")
    expect(repl).not.toContain('useFrustrationDetection')
    expect(repl).not.toContain('<FeedbackSurvey')
    expect(repl).not.toContain('handleSurveyRequestFeedback')
    expect(repl).not.toContain('AutoRunIssueNotification')
    expect(repl).not.toContain('How well did Claude use its memory?')
  })

  test('REPL does not initialize recovered connected-product integrations', () => {
    const repl = source('screens/REPL.tsx')

    for (const productIntegration of [
      'useReplBridge',
      'replBridgePermissionCallbacks',
      'RemoteCallout',
      'DesktopUpsellStartup',
      'useChromeExtensionNotification',
      'usePromptsFromLeviathanBrowser',
      'useCanSwitchToExistingSubscription',
      'SkillImprovementSurvey',
      'useSkillImprovementSurvey',
      'IssueFlagBanner',
      'useIssueFlagBanner',
    ]) {
      expect(repl).not.toContain(productIntegration)
    }
  })

  test('REPL notices and MCP status do not present recovered product services', () => {
    const repl = source('screens/REPL.tsx')
    const mcpStatus = source('hooks/notifs/useMcpConnectivityStatus.tsx')

    expect(repl).not.toContain('useNpmDeprecationNotification')
    expect(mcpStatus).not.toContain('hasClaudeAiMcpEverConnected')
    expect(mcpStatus).not.toContain('claude.ai')
    expect(mcpStatus).not.toContain('claudeai-proxy')
  })

  test('interactive status UI does not mount recovered billing or marketplace startup services', () => {
    const repl = source('screens/REPL.tsx')
    const notifications = source('components/PromptInput/Notifications.tsx')

    for (const productStartupHook of [
      'useRateLimitWarningNotification',
      'useInstallMessages',
      'useOfficialMarketplaceNotification',
    ]) {
      expect(repl).not.toContain(productStartupHook)
    }

    expect(notifications).not.toContain('useClaudeAiLimits')
    expect(notifications).not.toContain('getSubscriptionType')
    expect(notifications).not.toContain('Not logged in')
    expect(notifications).not.toContain('Run /login')
  })

  test('remote product settings and policy services are inert boundaries', () => {
    const init = source('entrypoints/init.ts')
    const main = source('main.tsx')
    const settings = source('services/remoteManagedSettings/index.ts')
    const settingsEligibility = source('services/remoteManagedSettings/syncCache.ts')
    const policy = source('services/policyLimits/index.ts')

    expect(init).not.toContain('initializeRemoteManagedSettingsLoadingPromise')
    expect(init).not.toContain('initializePolicyLimitsLoadingPromise')
    expect(init).not.toContain('waitForRemoteManagedSettingsToLoad')
    expect(main).not.toContain('loadRemoteManagedSettings')
    expect(main).not.toContain('loadPolicyLimits')
    expect(settings).not.toContain('/api/claude_code/settings')
    expect(settings).not.toContain('axios')
    expect(settingsEligibility).not.toContain('getClaudeAIOAuthTokens')
    expect(policy).not.toContain('/api/claude_code/policy_limits')
    expect(policy).not.toContain('axios')
    expect(policy).toContain('return true')
  })

  test('startup keychain prefetch does not read recovered OAuth account records', () => {
    const keychainPrefetch = source('utils/secureStorage/keychainPrefetch.ts')

    expect(keychainPrefetch).not.toContain('CREDENTIALS_SERVICE_SUFFIX')
    expect(keychainPrefetch).not.toContain('oauthSpawn')
    expect(keychainPrefetch).not.toContain('primeKeychainCacheFromPrefetch')
  })

  test('new secure-storage keychain records use Leviathan identity', () => {
    const keychainHelpers = source('utils/secureStorage/macOsKeychainHelpers.ts')

    expect(keychainHelpers).toContain('return `leviathan')
    expect(keychainHelpers).not.toContain('return `donk')
    expect(keychainHelpers).not.toContain("'claude-code-user'")
  })

  test('default runtime retains local feature cache without product analytics uploads', () => {
    const init = source('entrypoints/init.ts')
    const main = source('main.tsx')
    const print = source('cli/print.ts')
    const interactive = source('interactiveHelpers.tsx')
    const sinks = source('utils/sinks.ts')
    const sink = source('services/analytics/sink.ts')
    const growthbook = source('services/analytics/growthbook.ts')

    expect(init).not.toContain('initialize1PEventLogging')
    expect(init).not.toContain('firstPartyEventLogger')
    expect(main).not.toContain('initializeAnalyticsGates')
    expect(main).not.toContain('initializeGrowthBook')
    expect(print).not.toContain('initializeGrowthBook')
    expect(interactive).not.toContain('initializeGrowthBook')
    expect(sinks).not.toContain('initializeAnalyticsSink')
    expect(sink).not.toContain('trackDatadogEvent')
    expect(sink).not.toContain('logEventTo1P')
    expect(growthbook).not.toContain('@growthbook/growthbook')
    expect(growthbook).not.toContain('api.anthropic.com')
    expect(growthbook).not.toContain('firstPartyEventLogger')
    expect(growthbook).toContain('getGlobalConfig().cachedGrowthBookFeatures')
  })

  test('fast mode is a local provider capability without product account checks', () => {
    const fastMode = source('utils/fastMode.ts')
    const fastCommand = source('commands/fast/fast.tsx')
    const notification = source('hooks/notifs/useFastModeNotification.tsx')

    expect(fastMode).not.toContain('api/claude_code_penguin_mode')
    expect(fastMode).not.toContain('axios')
    expect(fastMode).not.toContain('getClaudeAIOAuthTokens')
    expect(fastMode).not.toContain('getOauthConfig')
    expect(fastMode).not.toContain('paid subscription')
    expect(fastMode).not.toContain('disabled by your organization')
    expect(fastMode).toContain("orgStatus = { status: 'enabled' }")
    expect(fastCommand).not.toContain('prefetchFastModeStatus')
    expect(fastCommand).not.toContain('code.claude.com')
    expect(notification).not.toContain('disabled by your organization')
  })

  test('configured telemetry cannot attach recovered product metrics exporters', () => {
    const instrumentation = source('utils/telemetry/instrumentation.ts')
    const bigquery = source('utils/telemetry/bigqueryExporter.ts')
    const optOut = source('services/api/metricsOptOut.ts')

    expect(instrumentation).not.toContain('BigQueryMetricsExporter')
    expect(instrumentation).not.toContain('isBigQueryMetricsEnabled')
    expect(bigquery).not.toContain('api.anthropic.com/api/claude_code/metrics')
    expect(bigquery).not.toContain('checkMetricsEnabled')
    expect(optOut).not.toContain(
      'api.anthropic.com/api/claude_code/organizations/metrics_enabled',
    )
  })

  test('startup tips are local Leviathan guidance without account or marketplace promotion', () => {
    const tips = source('services/tips/tipRegistry.ts')

    for (const removedProductDependency of [
      'DesktopUpsell',
      'OverageCreditUpsell',
      'OFFICIAL_MARKETPLACE_NAME',
      'loadKnownMarketplacesConfigSafe',
      'overageCreditGrant',
      'api/referral',
      'is1PApiCustomer',
    ]) {
      expect(tips).not.toContain(removedProductDependency)
    }

    expect(tips).not.toContain('Claude')
    expect(tips).not.toContain('donk')
    expect(tips).not.toContain('clau.de')
    expect(tips).toContain('Leviathan')
  })

  test('MCP settings cannot launch recovered product connector authorization', () => {
    const settings = source('components/mcp/MCPSettings.tsx')
    const menu = source('components/mcp/MCPRemoteServerMenu.tsx')

    expect(settings).not.toContain('code.claude.com')
    expect(settings).not.toContain('"claude.ai"')
    expect(settings).toContain('client.config.type !== "claudeai-proxy"')
    expect(menu).not.toContain('getOauthConfig')
    expect(menu).not.toContain('getOauthAccountInfo')
    expect(menu).not.toContain('CLAUDE_AI_ORIGIN')
    expect(menu).not.toContain('tengu_claudeai')
    expect(menu).not.toContain('openBrowser')
    expect(menu).not.toContain('claude.ai')
  })

  test('MCP connector service cannot fetch recovered account integrations', () => {
    const connectors = source('services/mcp/claudeai.ts')

    expect(connectors).not.toContain('axios')
    expect(connectors).not.toContain('getOauthConfig')
    expect(connectors).not.toContain('getClaudeAIOAuthTokens')
    expect(connectors).not.toContain('/v1/mcp_servers')
    expect(connectors).not.toContain('normalizeNameForMCP')
    expect(connectors).toContain('return {}')
    expect(connectors).toContain('return false')
  })

  test('plugin startup cannot seed or update recovered official product marketplaces', () => {
    const officialFetch = source('utils/plugins/officialMarketplaceGcs.ts')
    const marketplaceManager = source('utils/plugins/marketplaceManager.ts')
    const marketplaceSchemas = source('utils/plugins/schemas.ts')

    expect(officialFetch).not.toContain('downloads.claude.ai')
    expect(officialFetch).not.toContain('axios')
    expect(officialFetch).toContain('return null')
    expect(marketplaceManager).not.toContain('OFFICIAL_MARKETPLACE_SOURCE')
    expect(marketplaceManager).not.toContain('fetchOfficialMarketplaceFromGcs')
    expect(marketplaceManager).toContain('Built-in product marketplace')
    expect(marketplaceManager).toContain('delete declared[OFFICIAL_MARKETPLACE_NAME]')
    expect(marketplaceSchemas).toContain('return entry.autoUpdate ?? false')
  })

  test('interactive commands remain available without reinstalling the recovered product catalog', () => {
    const commands = source('commands.ts')
    const thinkback = source('commands/thinkback/thinkback.tsx')
    const thinkbackPlay = source('commands/thinkback-play/thinkback-play.ts')
    const startupCheck = source(
      'utils/plugins/officialMarketplaceStartupCheck.ts',
    )
    const marketplaceManager = source('utils/plugins/marketplaceManager.ts')

    expect(commands).toContain(
      "import thinkback from './commands/thinkback/index.js'",
    )
    expect(commands).toContain(
      "import thinkbackPlay from './commands/thinkback-play/index.js'",
    )
    expect(thinkback).not.toContain('anthropics/')
    expect(thinkback).not.toContain('OFFICIAL_MARKETPLACE_NAME')
    expect(thinkback).not.toContain('addMarketplaceSource')
    expect(thinkback).toContain('Leviathan-compatible thinkback plugin')
    expect(thinkbackPlay).not.toContain('OFFICIAL_MARKETPLACE_NAME')
    expect(thinkbackPlay).not.toContain('claude-code-marketplace')
    expect(startupCheck).not.toContain('addMarketplaceSource')
    expect(startupCheck).not.toContain('fetchOfficialMarketplaceFromGcs')
    expect(startupCheck).not.toContain('OFFICIAL_MARKETPLACE_SOURCE')
    expect(startupCheck).toContain("reason: 'policy_blocked'")
    expect(marketplaceManager).toContain(
      'isRecoveredBuiltInProductMarketplaceSource',
    )
  })

  test('plugin browsing cannot fetch recovered official install statistics', () => {
    const installCounts = source('utils/plugins/installCounts.ts')
    const movedCommand = source('commands/createMovedToPluginCommand.ts')
    const notification = source('hooks/useOfficialMarketplaceNotification.tsx')

    expect(installCounts).not.toContain('raw.githubusercontent.com/anthropics')
    expect(installCounts).not.toContain('axios')
    expect(installCounts).toContain('return null')
    expect(movedCommand).not.toContain('claude-code-marketplace')
    expect(movedCommand).not.toContain('github.com/anthropics')
    expect(notification).not.toContain('Anthropic marketplace')
    expect(notification).not.toContain('checkAndInstallOfficialMarketplace')
  })

  test('legacy MCP account proxy configs fail locally without product OAuth', () => {
    const client = source('services/mcp/client.ts')

    expect(client).not.toContain('createClaudeAiProxyFetch')
    expect(client).not.toContain('getClaudeAIOAuthTokens')
    expect(client).not.toContain('getOauthConfig')
    expect(client).not.toContain('Initializing claude.ai proxy')
    expect(client).toContain('Legacy account-backed MCP connectors are unavailable')
  })

  test('remote session APIs fail locally before product OAuth or network calls', () => {
    const teleportApi = source('utils/teleport/api.ts')
    const resumeTask = source('components/ResumeTask.tsx')

    expect(teleportApi).toContain('LEGACY_ACCOUNT_FEATURE_NOTICE')
    expect(teleportApi).not.toContain('getClaudeAIOAuthTokens')
    expect(teleportApi).not.toContain('getOrganizationUUID')
    expect(teleportApi).not.toContain('getOauthConfig')
    expect(teleportApi).not.toContain('axios.get')
    expect(teleportApi).not.toContain('axios.post')
    expect(teleportApi).not.toContain('axios.patch')
    expect(resumeTask).not.toContain('fetchCodeSessionsFromSessionsAPI')
    expect(resumeTask).not.toContain('Teleport requires a Claude account')
    expect(resumeTask).not.toContain('donk sessions')
  })

  test('teleport runtime cannot read product OAuth or create remote sessions', () => {
    const teleport = source('utils/teleport.tsx')

    for (const removedAccountDependency of [
      'getClaudeAIOAuthTokens',
      'checkAndRefreshOAuthTokenIfNeeded',
      'getOrganizationUUID',
      'getOauthConfig',
      'getOAuthHeaders',
      'getSessionLogsViaOAuth',
      'getTeleportEvents',
      'createAndUploadGitBundle',
      'fetchEnvironments',
      'axios',
      '/v1/sessions',
      '/api/organizations',
    ]) {
      expect(teleport).not.toContain(removedAccountDependency)
    }
    expect(teleport).toContain('LEGACY_ACCOUNT_FEATURE_NOTICE')
    expect(teleport).toContain('return null')
    expect(teleport).toContain('newEvents: []')
  })

  test('bridge account-control modules cannot read product OAuth or call account services', () => {
    const bridgeText = [
      source('bridge/bridgeEnabled.ts'),
      source('bridge/bridgeMain.ts'),
      source('bridge/bridgeApi.ts'),
      source('bridge/bridgeConfig.ts'),
      source('bridge/createSession.ts'),
      source('bridge/initReplBridge.ts'),
      source('bridge/trustedDevice.ts'),
    ].join('\n')

    for (const removedAccountDependency of [
      'getClaudeAIOAuthTokens',
      'checkAndRefreshOAuthTokenIfNeeded',
      'handleOAuth401Error',
      'getOrganizationUUID',
      'getOauthConfig',
      'getOAuthHeaders',
      'isClaudeAISubscriber',
      'hasProfileScope',
      'getOauthAccountInfo',
      'checkGate_CACHED_OR_BLOCKING',
      'getFeatureValue_CACHED_MAY_BE_STALE',
      'CLAUDE_BRIDGE_OAUTH_TOKEN',
      'CLAUDE_BRIDGE_BASE_URL',
      'CLAUDE_TRUSTED_DEVICE_TOKEN',
      '/api/auth/trusted_devices',
      'axios',
    ]) {
      expect(bridgeText).not.toContain(removedAccountDependency)
    }
    expect(bridgeText).toContain('LEGACY_ACCOUNT_FEATURE_NOTICE')
    expect(bridgeText).toContain('return null')
    expect(bridgeText).toContain('return undefined')
  })

  test('remote sync and cloud environment services are local-only boundaries', () => {
    const remoteSyncText = [
      source('utils/background/remote/preconditions.ts'),
      source('utils/teleport/environments.ts'),
      source('services/settingsSync/index.ts'),
      source('services/teamMemorySync/index.ts'),
      source('services/api/bootstrap.ts'),
      source('services/api/usage.ts'),
    ].join('\n')

    for (const removedAccountDependency of [
      'getClaudeAIOAuthTokens',
      'checkAndRefreshOAuthTokenIfNeeded',
      'hasProfileScope',
      'isClaudeAISubscriber',
      'getOrganizationUUID',
      'getOauthConfig',
      'getOAuthHeaders',
      'CLAUDE_AI_INFERENCE_SCOPE',
      'CLAUDE_AI_PROFILE_SCOPE',
      'OAUTH_BETA_HEADER',
      'api/claude_code',
      'api/oauth',
      'environment_providers',
      'axios',
      'checkNeedsClaudeAiLogin',
    ]) {
      expect(remoteSyncText).not.toContain(removedAccountDependency)
    }
    expect(remoteSyncText).toContain('checkNeedsLeviathanRemoteLogin')
    expect(remoteSyncText).toContain('return false')
    expect(remoteSyncText).toContain('return null')
    expect(remoteSyncText).toContain('return []')
  })

  test('core API, HTTP and analytics layers do not read product OAuth tokens', () => {
    const coreAuthText = [
      source('utils/http.ts'),
      source('services/api/client.ts'),
      source('services/api/withRetry.ts'),
      source('services/analytics/firstPartyEventLoggingExporter.ts'),
      source('main.tsx'),
    ].join('\n')

    for (const removedAccountDependency of [
      'getClaudeAIOAuthTokens',
      'handleOAuth401Error',
      'isClaudeAISubscriber',
      'hasProfileScope',
      'isOAuthTokenExpired',
      'OAUTH_BETA_HEADER',
      'checkAndRefreshOAuthTokenIfNeeded',
    ]) {
      expect(coreAuthText).not.toContain(removedAccountDependency)
    }
    expect(coreAuthText).toContain('No API key available')
    expect(coreAuthText).toContain('request()')
  })

  test('OAuth client and profile services cannot call recovered account APIs', () => {
    const oauthServiceText = [
      source('services/oauth/client.ts'),
      source('services/oauth/getOauthProfile.ts'),
    ].join('\n')

    for (const removedAccountDependency of [
      'axios',
      'getOauthConfig',
      'getClaudeAIOAuthTokens',
      'checkAndRefreshOAuthTokenIfNeeded',
      'hasProfileScope',
      'isClaudeAISubscriber',
      '/api/oauth',
      '/api/claude_cli_profile',
      'Authorization:',
      'api/oauth/claude_cli',
    ]) {
      expect(oauthServiceText).not.toContain(removedAccountDependency)
    }
    expect(oauthServiceText).toContain('LEGACY_ACCOUNT_FEATURE_NOTICE')
    expect(oauthServiceText).toContain('return null')
    expect(oauthServiceText).toContain('return undefined')
  })

  test('OAuth constants cannot route users back to recovered account login', () => {
    const oauthConstants = source('constants/oauth.ts')

    for (const removedAccountRoute of [
      'platform.claude.com',
      'claude.com/cai',
      'api/oauth/claude_cli',
      'user:sessions:claude_code',
      'LEVIATHAN_CODE_CUSTOM_OAUTH_URL',
      'LEVIATHAN_CODE_OAUTH_CLIENT_ID',
    ]) {
      expect(oauthConstants).not.toContain(removedAccountRoute)
    }
    expect(oauthConstants).toContain('https://leviathan.local')
    expect(oauthConstants).toContain('leviathan-code')
  })

  test('account-only API helper modules are inert local boundaries', () => {
    const accountApiText = [
      source('services/api/referral.ts'),
      source('services/api/overageCreditGrant.ts'),
      source('services/api/firstTokenDate.ts'),
      source('services/api/ultrareviewQuota.ts'),
      source('services/api/adminRequests.ts'),
    ].join('\n')

    for (const removedAccountDependency of [
      'axios',
      'getOauthConfig',
      'prepareApiRequest',
      'getOAuthHeaders',
      'getOauthAccountInfo',
      'isClaudeAISubscriber',
      '/api/oauth',
      'claude_code_guest_pass',
      'claude_code_first_token_date',
    ]) {
      expect(accountApiText).not.toContain(removedAccountDependency)
    }
    expect(accountApiText).toContain('LEGACY_ACCOUNT_FEATURE_NOTICE')
    expect(accountApiText).toContain('return null')
  })

  test('remote web setup cannot check product OAuth or upload GitHub tokens', () => {
    const webSetup = source('commands/remote-setup/remote-setup.tsx')
    const webSetupApi = source('commands/remote-setup/api.ts')

    expect(webSetup).toContain('LEGACY_ACCOUNT_FEATURE_NOTICE')
    expect(webSetup).not.toContain('isSignedIn')
    expect(webSetup).not.toContain('importGithubToken')
    expect(webSetup).not.toContain('openBrowser')
    expect(webSetup).not.toContain('Claude')

    expect(webSetupApi).not.toContain('axios')
    expect(webSetupApi).not.toContain('getOauthConfig')
    expect(webSetupApi).not.toContain('prepareApiRequest')
    expect(webSetupApi).not.toContain('/v1/code/github/import-token')
    expect(webSetupApi).not.toContain('/v1/environment_providers/cloud/create')
    expect(webSetupApi).toContain(
      "return { ok: false, error: { kind: 'not_signed_in' } }",
    )
    expect(webSetupApi).toContain('return false')
  })

  test('feedback transcript sharing is local-only and cannot upload account data', () => {
    const transcriptShare = source(
      'components/FeedbackSurvey/submitTranscriptShare.ts',
    )

    expect(transcriptShare).not.toContain('axios')
    expect(transcriptShare).not.toContain('checkAndRefreshOAuthTokenIfNeeded')
    expect(transcriptShare).not.toContain('getAuthHeaders')
    expect(transcriptShare).not.toContain('getUserAgent')
    expect(transcriptShare).not.toContain('claude_code_shared_session_transcripts')
    expect(transcriptShare).toContain('return { success: false }')
  })
})
