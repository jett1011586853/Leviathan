import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

function source(relativePath: string): string {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8').split(
    '//# sourceMappingURL=',
    1,
  )[0]
}

describe('Leviathan visible branding', () => {
  test('safety dialogs and command descriptions use Leviathan naming', () => {
    for (const file of [
      'components/TrustDialog/TrustDialog.tsx',
      'components/BypassPermissionsModeDialog.tsx',
      'components/LeviathanMdExternalIncludesDialog.tsx',
      'commands.ts',
      'commands/doctor/index.ts',
    ]) {
      expect(source(file)).not.toContain('donk')
    }

    const safetyCopy = [
      source('components/TrustDialog/TrustDialog.tsx'),
      source('components/BypassPermissionsModeDialog.tsx'),
      source('components/LeviathanMdExternalIncludesDialog.tsx'),
    ].join('\n')
    expect(safetyCopy).not.toContain('code.claude.com')
  })

  test('update, attribution and configuration text use Leviathan naming', () => {
    for (const file of [
      'cli/update.ts',
      'utils/attribution.ts',
      'tools/ConfigTool/prompt.ts',
      'tools/ConfigTool/ConfigTool.ts',
      'components/AutoUpdater.tsx',
    ]) {
      expect(source(file)).not.toContain('donk')
    }
    const attribution = source('utils/attribution.ts')
    expect(attribution).toContain('Co-Authored-By: Leviathan')
    expect(attribution).toContain('noreply@leviathan.local')
    expect(attribution).not.toContain('noreply@anthropic.com')
    expect(attribution).not.toContain('claude-opus-4-5')
    const configPrompt = source('tools/ConfigTool/prompt.ts')
    expect(configPrompt).toContain('~/.leviathan/.leviathan.json')
    expect(configPrompt).not.toContain('~/.claude.json')
  })

  test('update and configuration output do not direct users to Claude account services', () => {
    const update = source('cli/update.ts')
    const config = source('tools/ConfigTool/ConfigTool.ts')

    expect(update).not.toContain('Claude is managed')
    expect(update).not.toContain('Anthropic.ClaudeCode')
    expect(update).not.toContain('brew upgrade claude-code')
    expect(update).not.toContain('apk upgrade claude-code')
    expect(update).not.toContain('Try running "claude doctor"')
    const autoUpdater = source('components/AutoUpdater.tsx')
    expect(autoUpdater).not.toContain('claude doctor')
    expect(autoUpdater).not.toContain('~/.claude/local')
    expect(autoUpdater).toContain('leviathan doctor')
    expect(autoUpdater).toContain('~/.leviathan/local')
    expect(config).not.toContain('Claude.ai account')
    expect(config).not.toContain('/login to sign in')
  })

  test('IDE onboarding no longer teaches the recovered brand', () => {
    const ideOnboarding = source('components/IdeOnboardingDialog.tsx')

    expect(ideOnboarding).not.toContain('Claude has context')
    expect(ideOnboarding).not.toContain("Review donk's changes")
  })

  test('main command help does not present the recovered name', () => {
    const main = source('main.tsx')

    expect(main).not.toContain('Start the donk MCP server')
    expect(main).not.toContain('Start a donk session server')
    expect(main).not.toContain('Run donk on a remote host')
    expect(main).not.toContain('Connect to a donk server')
    expect(main).not.toContain('donk auto-updater')
    expect(main).not.toContain('Install donk native build')
  })

  test('top-level CLI examples use Leviathan commands', () => {
    const main = source('main.tsx')
    const bashReadOnly = source('tools/BashTool/readOnlyValidation.ts')

    for (const removed of [
      'Usage: claude --remote',
      'Resume with: claude --teleport',
      'run claude --teleport',
      'run `claude assistant`',
      '$ claude export',
      'claude --plugin-dir',
      'claude --help',
    ]) {
      expect(`${main}\n${bashReadOnly}`).not.toContain(removed)
    }
    expect(main).toContain('Usage: leviathan --remote')
    expect(main).toContain('Resume with: leviathan --teleport')
    expect(bashReadOnly).toContain('/^leviathan --help$/')
  })

  test('permission and mode dialogs speak as Leviathan', () => {
    const dialogs = [
      'components/AutoModeOptInDialog.tsx',
      'components/ThinkingToggle.tsx',
      'components/permissions/PermissionRequest.tsx',
      'components/permissions/PermissionPrompt.tsx',
      'components/permissions/EnterPlanModePermissionRequest/EnterPlanModePermissionRequest.tsx',
      'components/permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.tsx',
      'components/permissions/BashPermissionRequest/bashToolUseOptions.tsx',
      'components/permissions/PowerShellPermissionRequest/powershellToolUseOptions.tsx',
      'components/permissions/WebFetchPermissionRequest/WebFetchPermissionRequest.tsx',
      'components/permissions/SandboxPermissionRequest.tsx',
      'components/permissions/FilePermissionDialog/permissionOptions.tsx',
      'components/permissions/rules/AddWorkspaceDirectory.tsx',
      'components/permissions/rules/RemoveWorkspaceDirectory.tsx',
      'components/permissions/rules/PermissionRuleList.tsx',
    ].map(source).join('\n')

    for (const phrase of [
      'donk',
      'Claude wants',
      'Claude will',
      'Claude has',
      "Claude's plan",
      'Claude&apos;s plan',
      'tell Claude',
      'allow Claude',
      'code.claude.com',
    ]) {
      expect(dialogs).not.toContain(phrase)
    }
  })

  test('everyday local commands and settings expose Leviathan branding', () => {
    for (const file of [
      'commands/copy/index.ts',
      'commands/model/index.ts',
      'commands/stats/index.ts',
      'commands/statusline.tsx',
      'commands/thinkback/index.ts',
      'commands/memory/index.ts',
      'commands/plugin/index.tsx',
      'commands/install.tsx',
      'components/Stats.tsx',
    ]) {
      expect(source(file)).not.toContain('donk')
    }
    const settings = source('components/Settings/Config.tsx')
    expect(settings).not.toContain('Push when Claude decides')
    expect(settings).not.toContain('Claude in Chrome enabled by default')
    const ide = source('commands/ide/ide.tsx')
    expect(ide).not.toContain('docs.claude.com')
    expect(ide).not.toContain('donk extension')
    expect(ide).not.toContain('one donk instance')
  })

  test('installer and IDE integration use Leviathan-facing executable names', () => {
    const install = source('commands/install.tsx')
    const utilHandler = source('cli/handlers/util.tsx')
    const branding = source('leviathan/branding.ts')
    const main = source('main.tsx')
    const ide = source('commands/ide/ide.tsx')
    const localInstaller = [
      source('utils/localInstaller.ts'),
      source('utils/shellConfig.ts'),
      source('utils/nativeInstaller/installer.ts'),
      source('utils/nativeInstaller/pidLock.ts'),
    ].join('\n')

    expect(utilHandler).toContain('LEVIATHAN_DISTRIBUTION_NOTICE')
    expect(utilHandler).not.toContain("await setup(cwd()")
    expect(utilHandler).not.toContain("import('../../commands/install.js')")
    expect(branding).toContain(
      'Leviathan self-install is disabled until a Leviathan distribution source is configured.',
    )
    expect(install).toContain('LEVIATHAN_DISTRIBUTION_NOTICE')
    expect(install).not.toContain('installLatest')
    expect(install).not.toContain("'.local', 'bin', 'claude.exe'")
    expect(install).not.toContain('~/.local/bin/claude')
    expect(install).not.toContain('installing Claude')
    expect(install).not.toContain('claude --help')
    expect(main).toContain('Self-install is unavailable until a Leviathan distribution source is configured')
    expect(main).not.toContain('Install Leviathan native build. Use [target]')
    expect(ide).not.toContain('No IDEs with donk extension detected.')
    for (const removed of [
      'claude-local',
      'node_modules/.bin/claude',
      'alias\\s+claude',
      '$HOME/.claude/local/claude',
      'claude-cli-native-',
      'claude command',
      'Removed claude alias',
      'unalias claude',
      '~/.claude/local',
      'running donk versions',
    ]) {
      expect(localInstaller).not.toContain(removed)
    }
    expect(localInstaller).toContain('leviathan-local')
    expect(localInstaller).toContain('node_modules/.bin/leviathan')
  })

  test('settings do not expose disabled remote control startup behavior', () => {
    const settings = source('components/Settings/Config.tsx')

    expect(settings).not.toContain("id: 'remoteControlAtStartup'")
    expect(settings).not.toContain('getRemoteControlAtStartup')
    expect(settings).not.toContain('isBridgeEnabled')
  })

  test('REPL messages and top-level help present Leviathan rather than recovered naming', () => {
    const repl = source('screens/REPL.tsx')
    const main = source('main.tsx')

    expect(repl).toContain("import { PRODUCT_NAME } from '../leviathan/branding.js'")
    expect(repl).not.toContain("?? 'donk'")
    expect(repl).not.toContain('Claude is waiting for your input')
    expect(repl).not.toContain('donk has been suspended')
    expect(repl).not.toContain('.claude/settings.json')
    expect(repl).toContain('.leviathan/settings.json')
    expect(main).toContain('The workspace trust dialog is skipped when Leviathan runs in print mode')
    expect(main).toContain('project instruction auto-discovery')
    expect(main).toContain('Provider credentials are read only from explicitly configured API key settings')
    expect(main).toContain("for example 'mimo-v2.5'")
    expect(main).not.toContain("e.g. 'claude-sonnet-4-6'")
    expect(main).not.toContain("e.g. 'sonnet' or 'opus'")
  })

  test('MCP help does not offer recovered desktop product imports', () => {
    const main = source('main.tsx')

    expect(main).not.toContain('add-from-claude-desktop')
    expect(main).not.toContain('Import MCP servers from Claude Desktop')
  })

  test('interactive help, cost and MCP panels avoid recovered product copy and documentation', () => {
    const help = source('components/HelpV2/HelpV2.tsx')
    const cost = source('components/CostThresholdDialog.tsx')
    const approval = source('components/MCPServerDialogCopy.tsx')
    const list = source('components/mcp/MCPListPanel.tsx')

    expect(help).not.toContain('donk v')
    expect(help).not.toContain('code.claude.com')
    expect(help).toContain('Leviathan')
    expect(cost).not.toContain('Anthropic API')
    expect(cost).not.toContain('code.claude.com')
    expect(approval).not.toContain('code.claude.com')
    expect(list).not.toContain('code.claude.com')
    expect(list).not.toContain('>claude.ai</Text>')
    expect(list).not.toContain('Run claude --debug')
  })

  test('MCP protocol client identifies the application as Leviathan', () => {
    const client = source('services/mcp/client.ts')

    expect(client).toContain("name: 'leviathan-code'")
    expect(client).toContain('title: PRODUCT_NAME')
    expect(client).toContain("'leviathan/toolUseId'")
    expect(client).toContain("'X-Leviathan-Code-Ide-Authorization'")
    expect(client).not.toContain("'claudecode/toolUseId'")
    expect(client).not.toContain("'X-Claude-Code-Ide-Authorization'")
    expect(client).not.toContain("name: 'claude-code'")
    expect(client).not.toContain("title: 'donk'")
    expect(client).not.toContain("Anthropic's agentic coding tool")
  })

  test('plugin interaction copy is owned by Leviathan rather than the recovered product', () => {
    const pluginUi = [
      source('commands/plugin/DiscoverPlugins.tsx'),
      source('commands/plugin/ManageMarketplaces.tsx'),
      source('commands/plugin/PluginTrustWarning.tsx'),
      source('commands/plugin/ManagePlugins.tsx'),
      source('commands/plugin/ValidatePlugin.tsx'),
    ].join('\n')

    expect(pluginUi).not.toContain('restart donk')
    expect(pluginUi).not.toContain('donk will automatically update')
    expect(pluginUi).not.toContain('Anthropic does not control')
    expect(pluginUi).not.toContain('claude plugin validate')
    expect(pluginUi).not.toContain('.claude/settings.json')
    expect(pluginUi).not.toContain('.claude/settings.local.json')
    expect(pluginUi).toContain('leviathan plugin validate')
    expect(pluginUi).toContain('.leviathan/settings.json')
    expect(pluginUi).toContain('Leviathan')
  })

  test('CLI help and insights reports present Leviathan instruction terminology', () => {
    const main = source('main.tsx')
    const insights = source('commands/insights.ts')

    expect(main).not.toContain('when Claude is run with the -p mode')
    expect(main).not.toContain('CLAUDE.md auto-discovery')
    expect(main).not.toContain('Force Claude to use multi-agent mode')
    expect(main).not.toContain('# claude up')
    expect(main).not.toContain('nearest CLAUDE.md')
    expect(insights).toContain('Leviathan Insights')
    expect(insights).not.toContain('donk')
    expect(insights).not.toContain('CLAUDE.md')
    expect(insights).not.toContain('Claude Got Blocked')
    expect(insights).not.toContain('What Claude did')
    expect(insights).not.toContain("Claude's Capabilities")
    expect(insights).not.toContain('claude mcp add')
    expect(insights).not.toContain('.claude/skills')
    expect(insights).not.toContain('.claude/settings.json')
    expect(insights).not.toContain('/root/.claude/projects')
    expect(insights).toContain('leviathan mcp add')
    expect(insights).toContain('.leviathan/skills')
    expect(insights).toContain('/root/.leviathan/projects')
  })

  test('bundled configuration guidance writes Leviathan settings and uses configured marketplaces', () => {
    const skill = source('skills/bundled/updateConfig.ts')
    const commands = source('commands.ts')

    expect(skill).toContain('.leviathan/settings.json')
    expect(skill).not.toContain('.claude/settings')
    expect(skill).not.toContain('donk')
    expect(skill).not.toContain('Claude stops')
    expect(skill).not.toContain('claude-code-marketplace')
    expect(skill).not.toContain('claude-plugins-official')
    expect(commands).not.toContain('goodClaude')
    expect(commands).not.toContain('good-claude')
  })

  test('registered review, status, and diagnostic skill copy is Leviathan-owned', () => {
    const review = source('commands/review.ts')
    const status = source('commands/status/index.ts')
    const stuck = source('skills/bundled/stuck.ts')

    expect(review).not.toContain('donk on the web')
    expect(review).not.toContain('code.claude.com')
    expect(status).not.toContain('donk status')
    expect(status).not.toContain('account')
    expect(stuck).not.toContain('donk')
    expect(stuck).not.toContain('#claude-code-feedback')
    expect(stuck).not.toContain('Claude')
    expect(stuck).toContain('Leviathan')
  })

  test('prompt input does not surface removed cloud planning or review flows', () => {
    const promptInput = source('components/PromptInput/PromptInput.tsx')
    const reviewGate = source('commands/review/ultrareviewEnabled.ts')

    for (const removed of [
      'isUltrareviewEnabled',
      'findUltrareviewTriggerPositions',
      'findUltraplanTriggerPositions',
      'ultraplan-active',
      'ultrareview-active',
      'donk on the web',
      'review these changes in the cloud',
      'after Claude finishes',
    ]) {
      expect(promptInput).not.toContain(removed)
    }
    expect(reviewGate).toContain('return false')
    expect(reviewGate).not.toContain('getFeatureValue_CACHED_MAY_BE_STALE')
  })

  test('common interactive UI copy does not expose recovered product wording', () => {
    const userFacing = [
      source('components/LogoV2/LogoV2.tsx'),
      source('components/ModelPicker.tsx'),
      source('components/OutputStylePicker.tsx'),
      source('components/ThemePicker.tsx'),
      source('components/messages/AssistantTextMessage.tsx'),
      source('components/sandbox/SandboxSettings.tsx'),
      source('components/sandbox/SandboxOverridesTab.tsx'),
      source(
        'components/permissions/ComputerUseApproval/ComputerUseApproval.tsx',
      ),
      source(
        'components/permissions/SkillPermissionRequest/SkillPermissionRequest.tsx',
      ),
      source('components/permissions/rules/AddPermissionRules.tsx'),
      source('commands/memory/memory.tsx'),
      source('utils/preflightChecks.tsx'),
      source('utils/windowsPaths.ts'),
    ].join('\n')

    for (const removed of [
      'Claude completes',
      'future donk sessions',
      'how donk communicates',
      'Hello, Claude',
      'platform.claude.com/settings/billing',
      'code.claude.com/docs',
      'docs.claude.com',
      'Claude uses',
      'restart donk',
      'tell Claude',
      'while Claude works',
      'Claude may use',
      '~/.claude/settings.json',
      '.claude/settings.json',
      'donk might not be available',
      'donk was unable',
      'donk on Windows',
    ]) {
      expect(userFacing).not.toContain(removed)
    }
    expect(userFacing).toContain('Leviathan')
  })

  test('mobile app, app-install, and everyday assistant UI speak as Leviathan', () => {
    const everydayUi = [
      source('commands/mobile/index.ts'),
      source('commands/mobile/mobile.tsx'),
      source('commands/install-slack-app/index.ts'),
      source('commands/install-slack-app/install-slack-app.ts'),
      source('commands/install-github-app/ExistingWorkflowStep.tsx'),
      source('commands/install-github-app/InstallAppStep.tsx'),
      source('commands/install-github-app/SuccessStep.tsx'),
      source('commands/install-github-app/WarningsStep.tsx'),
      source('commands/install-github-app/ErrorStep.tsx'),
      source('components/InterruptedByUser.tsx'),
      source('components/HelpV2/General.tsx'),
      source('components/LogSelector.tsx'),
      source('components/messages/UserToolResultMessage/RejectedPlanMessage.tsx'),
      source('tools/AskUserQuestionTool/AskUserQuestionTool.tsx'),
      source('tools/EnterPlanModeTool/UI.tsx'),
      source('tools/ExitPlanModeTool/UI.tsx'),
      source('tools/BashTool/BashToolResultMessage.tsx'),
      source('tools/PowerShellTool/UI.tsx'),
      source('tools/BriefTool/UI.tsx'),
      source('tools/ConfigTool/supportedSettings.ts'),
    ].join('\n')

    for (const removed of [
      'Claude mobile app',
      'claude-by-anthropic',
      'com.anthropic.claude',
      'Claude Slack app',
      'A08SF47R6P4-claude',
      'Claude GitHub App',
      'Claude workflow file',
      'claude.yml',
      'github.com/apps/claude',
      'anthropics/claude-code-action',
      'Claude PR assistance',
      'What should Claude do instead?',
      'Claude understands your codebase',
      'Claude found these results',
      'Search deeply using Claude',
      'Searching with Claude',
      "Claude's plan",
      'Claude&apos;s plan',
      "Claude's questions",
      'sent to Claude',
      '>Claude</Text>',
      'Preferred language for Claude',
      'after Claude finishes',
      'Allow Claude to push',
    ]) {
      expect(everydayUi).not.toContain(removed)
    }
    expect(everydayUi).toContain('Leviathan')
  })

  test('local helper commands use Leviathan CLI names and config paths', () => {
    const helpers = [
      source('cli/handlers/mcp.tsx'),
      source('cli/handlers/plugins.ts'),
      source('commands/mcp/addCommand.ts'),
      source('commands/mcp/xaaIdpCommand.ts'),
      source('commands/sandbox-toggle/sandbox-toggle.tsx'),
      source('commands/statusline.tsx'),
      source('commands/init-verifiers.ts'),
    ].join('\n')

    for (const removed of [
      'Add an MCP server to donk',
      'claude mcp add',
      'claude mcp remove',
      'claude mcp xaa',
      'claude plugin install',
      "donk's client_id",
      'CLAUDE_CODE_ENABLE_XAA',
      '.claude/settings.json',
      '.claude/settings.local.json',
      'Claude Chrome Extension',
      '.claude/skills',
      'when Claude runs',
      'start donk',
    ]) {
      expect(helpers).not.toContain(removed)
    }
    expect(helpers).toContain('leviathan mcp add')
    expect(helpers).toContain('leviathan plugin install')
    expect(helpers).toContain('.leviathan/settings.json')
    expect(helpers).toContain('.leviathan/skills')
  })

  test('resume, diagnostics, completions and user agents use Leviathan identity', () => {
    const localIdentity = [
      source('utils/crossProjectResume.ts'),
      source('utils/gracefulShutdown.ts'),
      source('utils/doctorDiagnostic.ts'),
      source('utils/completionCache.ts'),
      source('utils/git.ts'),
      source('utils/http.ts'),
      source('utils/userAgent.ts'),
    ].join('\n')

    for (const removed of [
      'claude --resume',
      'alias claude',
      '~/.claude/local/claude',
      '`donk install`',
      '# donk shell completions',
      'donk update',
      'donk auto-stash',
      '`claude-cli`',
      'claude-cli/',
      'claude-code/',
      'Claude-User',
      'claude-code suffix',
      "which('claude')",
      '.local/bin/claude',
      "'.claude', 'local'",
      '@anthropic-ai/claude-code',
      'valid Claude binary',
    ]) {
      expect(localIdentity).not.toContain(removed)
    }
    expect(localIdentity).toContain('leviathan --resume')
    expect(localIdentity).toContain('leviathan-cli/')
    expect(localIdentity).toContain('leviathan-code/')
  })

  test('web access tool permission copy speaks as Leviathan', () => {
    const webTools = [
      source('tools/WebSearchTool/WebSearchTool.ts'),
      source('tools/WebFetchTool/WebFetchTool.ts'),
      source('tools/WebFetchTool/utils.ts'),
      source('tools/WebFetchTool/preapproved.ts'),
    ].join('\n')

    for (const removed of [
      'Claude wants to search',
      'Claude wants to fetch',
      'Claude requested permissions',
      'donk is unable to fetch',
      'blocking claude.ai',
      'api.anthropic.com/api/web/domain_info',
      'code.claude.com',
    ]) {
      expect(webTools).not.toContain(removed)
    }
    expect(webTools).toContain('Leviathan wants to search')
    expect(webTools).toContain('Leviathan wants to fetch')
  })

  test('settings and SDK schema descriptions expose Leviathan config paths', () => {
    const schemaText = [
      source('utils/settings/types.ts'),
      source('utils/settings/constants.ts'),
      source('utils/settings/mdm/constants.ts'),
      source('utils/settings/mdm/settings.ts'),
      source('entrypoints/agentSdkTypes.ts'),
      source('entrypoints/sdk/coreSchemas.ts'),
      source('entrypoints/sandboxTypes.ts'),
    ].join('\n')

    for (const removed of [
      '~/.claude/settings.json',
      '.claude/settings.json',
      '.claude/settings.local.json',
      '~/.claude/projects',
      '~/.claude/agent-memory',
      '.claude/agent-memory',
      'Default permission mode when donk needs access',
      'JSON Schema reference for donk settings',
      'Environment variables to set for donk sessions',
      'standard donk attribution',
      'Override the default model used by donk',
      'repository .claude/settings.json',
      'Claude will not read from or write to the auto-memory directory',
      'CLAUDE_CODE_ENABLE_XAA',
      "Claude's co-authored by attribution",
      "Claude's system prompt",
      'Claude responses and voice dictation',
      'claude-cli://',
      '~/.claude/plans/',
      'Start Claude in assistant mode',
      'com.anthropic.claudecode',
      'Policies\\\\ClaudeCode',
      'donk settings',
      'donk MDM',
      'donk Agent SDK',
      '<dir>/.claude/scheduled_tasks.json',
      'Anthropic OAuth login',
      "model: 'claude-sonnet-4-6'",
      '"claude-sonnet-4-6"',
      "'claude-opus-4-5'",
    ]) {
      expect(schemaText).not.toContain(removed)
    }
    expect(schemaText).toContain('~/.leviathan/settings.json')
    expect(schemaText).toContain('.leviathan/settings.json')
    expect(schemaText).toContain('~/.leviathan/projects')
    expect(schemaText).toContain('~/.leviathan/agent-memory')
    expect(schemaText).toContain('leviathan-cli://')
    expect(schemaText).toContain('com.leviathan.code')
    expect(schemaText).toContain('mimo-v2.5')
  })

  test('configuration source UI points users at Leviathan paths', () => {
    const configUi = [
      source('components/TrustDialog/utils.ts'),
      source('utils/hooks/hooksSettings.ts'),
      source('utils/sessionStart.ts'),
      source('components/skills/SkillsMenu.tsx'),
    ].join('\n')

    for (const removed of [
      '.claude/settings.json',
      '.claude/settings.local.json',
      '~/.claude/settings.json',
      '~/.claude/plugins/',
      '~/.claude/plugins/*/hooks/hooks.json',
      '.claude/skills/',
      '~/.claude/skills/',
      'registered internally by donk',
      'Note to CLAUDE',
    ]) {
      expect(configUi).not.toContain(removed)
    }
    expect(configUi).toContain('.leviathan/settings.json')
    expect(configUi).toContain('~/.leviathan/plugins/')
    expect(configUi).toContain('.leviathan/skills/')
  })

  test('hooks browser uses Leviathan guidance and paths', () => {
    const hooksUi = [
      source('components/hooks/SelectEventMode.tsx'),
      source('components/hooks/ViewHookMode.tsx'),
      source('components/hooks/SelectMatcherMode.tsx'),
      source('components/hooks/SelectHookMode.tsx'),
      source('components/hooks/HooksConfigMenu.tsx'),
    ].join('\n')

    for (const removed of [
      'ask Claude',
      '~/.claude/settings.json',
      '.claude/settings.json',
      '.claude/settings.local.json',
      'https://code.claude.com/docs/en/hooks',
    ]) {
      expect(hooksUi).not.toContain(removed)
    }
    expect(hooksUi).toContain('ask Leviathan')
    expect(hooksUi).toContain('~/.leviathan/settings.json')
  })

  test('agent creation, MCP diagnostics and local guidance do not send users to Claude docs', () => {
    const localGuidance = [
      source('components/agents/new-agent-creation/wizard-steps/DescriptionStep.tsx'),
      source('components/mcp/McpParsingWarnings.tsx'),
      source('services/mcp/config.ts'),
      source('commands/model/model.tsx'),
      source('utils/settings/validationTips.ts'),
    ].join('\n')

    for (const removed of [
      'tell Claude',
      'When should Claude use this agent?',
      'https://code.claude.com/docs/en/mcp',
      'https://code.claude.com/docs/en/model-config',
      'https://code.claude.com/docs/en',
      'claude mcp add',
      'donk MCP',
    ]) {
      expect(localGuidance).not.toContain(removed)
    }
    expect(localGuidance).toContain('tell Leviathan')
    expect(localGuidance).toContain('When should Leviathan use this agent?')
  })

  test('plugin backend guidance uses Leviathan commands and settings paths', () => {
    const pluginBackend = [
      source('services/plugins/pluginOperations.ts'),
      source('utils/plugins/marketplaceManager.ts'),
      source('utils/plugins/validatePlugin.ts'),
      source('utils/plugins/schemas.ts'),
      source('utils/plugins/installedPluginsManager.ts'),
    ].join('\n')

    for (const removed of [
      'claude plugin disable',
      'claude plugin validate',
      'claude plugin marketplace remove',
      'claude marketplace remove',
      '.claude/settings.json',
      '.claude/settings.local.json',
      'Marketplace manager for donk plugins',
      'donk accepts',
      'donk version',
      'Maintained automatically by donk',
    ]) {
      expect(pluginBackend).not.toContain(removed)
    }
    expect(pluginBackend).toContain('leviathan plugin disable')
    expect(pluginBackend).toContain('.leviathan/settings.json')
  })

  test('runtime safety, voice and notification messages speak as Leviathan', () => {
    const runtimeMessages = [
      source('setup.ts'),
      source('bootstrap/state.ts'),
      source('tools/BashTool/pathValidation.ts'),
      source('tools/PowerShellTool/pathValidation.ts'),
      source('tools/FileReadTool/prompt.ts'),
      source('utils/messages.ts'),
      source('components/mcp/ElicitationDialog.tsx'),
      source('commands/voice/voice.ts'),
      source('services/voice.ts'),
      source('hooks/useVoice.ts'),
      source('services/notifier.ts'),
      source('services/PromptSuggestion/promptSuggestion.ts'),
      source('services/api/errors.ts'),
      source('tools/TeamCreateTool/prompt.ts'),
      source('tools/TeamDeleteTool/prompt.ts'),
      source('hooks/useDiffInIDE.ts'),
      source('components/LogoV2/ChannelsNotice.tsx'),
      source(
        'components/ManagedSettingsSecurityDialog/ManagedSettingsSecurityDialog.tsx',
      ),
    ].join('\n')

    for (const removed of [
      'donk requires Node.js',
      'Cost of the donk session',
      'For security, donk',
      'donk may only',
      'donk is a multimodal',
      "donk is running in don't ask mode",
      'donk needs your input',
      'Claude.ai account',
      'run donk locally',
      'run donk in native Windows',
      "DEFAULT_TITLE = 'donk'",
      'next into donk',
      'does not have access to donk',
      'donk is unable to respond',
      'donk has microphone access',
      '[donk]',
      'Restart donk',
      'exit donk',
      '~/.claude/teams',
      '~/.claude/tasks',
      '.claude/agents/',
      '/model claude-sonnet-4-20250514',
    ]) {
      expect(runtimeMessages).not.toContain(removed)
    }
    expect(runtimeMessages).toContain('Leviathan requires Node.js')
    expect(runtimeMessages).toContain('Leviathan needs your input')
    expect(runtimeMessages).toContain("DEFAULT_TITLE = 'Leviathan'")
    expect(runtimeMessages).toContain('next into Leviathan')
    expect(runtimeMessages).toContain('~/.leviathan/teams')
    expect(runtimeMessages).toContain('/model mimo-v2.5')
  })

  test('local rate-limit guidance does not mention the recovered CLI name', () => {
    const rateLimitMessages = source('services/rateLimitMessages.ts')

    expect(rateLimitMessages).not.toContain('keep using donk')
    expect(rateLimitMessages).toContain('keep using Leviathan')
  })

  test('auxiliary local prompts and repo handoff copy use Leviathan identity', () => {
    const auxiliaryLocalCopy = [
      source('cli/handlers/autoMode.ts'),
      source('utils/bash/commands.ts'),
      source('utils/bash/ShellSnapshot.ts'),
      source('utils/hooks/execAgentHook.ts'),
      source('utils/hooks/execPromptHook.ts'),
      source('components/Feedback.tsx'),
      source('components/TeleportRepoMismatchDialog.tsx'),
      source('constants/prompts.ts'),
    ].join('\n')

    for (const removed of [
      'for donk',
      'donk has an "auto mode"',
      'claude auto-mode defaults',
      'donk Code Bash',
      'donk agent',
      'donk defaults',
      'stop condition in donk',
      'hook in donk',
      'donk&apos;s functionality',
      'bug report for donk',
      'donk is an agentic coding CLI',
      'Open donk',
      'Run claude --teleport',
      'anthropics/claude-code#100',
      'anthropics/claude-code/issues',
      'anthropics/claude-cli-internal/issues',
    ]) {
      expect(auxiliaryLocalCopy).not.toContain(removed)
    }
    expect(auxiliaryLocalCopy).toContain('Leviathan')
    expect(auxiliaryLocalCopy).toContain('leviathan auto-mode defaults')
    expect(auxiliaryLocalCopy).toContain('Run leviathan --teleport')
  })

  test('logo feed copy uses Leviathan identity', () => {
    const logoFeeds = source('components/LogoV2/feedConfigs.tsx')

    for (const removed of [
      'donk changelog',
      'launched claude',
      'Share donk',
      'Share Claude Code',
      'Claude Code with friends',
    ]) {
      expect(logoFeeds).not.toContain(removed)
    }
    expect(logoFeeds).toContain('Leviathan changelog')
    expect(logoFeeds).toContain('launched Leviathan')
    expect(logoFeeds).toContain('Share Leviathan')
  })

  test('core startup and command source comments use Leviathan identity', () => {
    const sourceFacingCopy = [
      source('bootstrap/state.ts'),
      source('cli/exit.ts'),
      source('commands/exit/exit.tsx'),
      source('commands/remote-setup/api.ts'),
      source('commands/rename/rename.ts'),
      source('commands/terminalSetup/terminalSetup.tsx'),
      source('components/design-system/LoadingState.tsx'),
      source('components/Settings/Config.tsx'),
      source('constants/oauth.ts'),
      source('entrypoints/cli.tsx'),
    ].join('\n')

    for (const removed of [
      'donk',
      'Claude.ai OAuth scopes',
      'Claude.ai subscribers',
      'Claude.ai web pages',
      '`claude mcp *`',
      '`claude plugin *`',
      '`claude --bg`',
      '`claude attach`',
      '`claude remote-control`',
      '~/.claude/sessions',
      '.claude/scheduled_tasks.json',
      'claude.ai/code',
    ]) {
      expect(sourceFacingCopy).not.toContain(removed)
    }
    expect(sourceFacingCopy).toContain('Leviathan')
  })

  test('auth, config and diagnostics source comments use Leviathan paths', () => {
    const diagnosticsCopy = [
      source('utils/auth.ts'),
      source('utils/config.ts'),
      source('utils/log.ts'),
      source('utils/debug.ts'),
      source('utils/concurrentSessions.ts'),
      source('utils/cronTasks.ts'),
      source('utils/cronTasksLock.ts'),
    ].join('\n')

    for (const removed of [
      'donk',
      'claude --print',
      '`claude --debug`',
      '`claude --bg`',
      '~/.claude.json',
      '~/.claude/debug/latest',
      '~/.claude/errors/',
      '~/.claude/backups/',
      '.claude/scheduled_tasks.json',
      'Claude.ai subscribers',
      'claude remote-control',
      'claude-cli://',
    ]) {
      expect(diagnosticsCopy).not.toContain(removed)
    }
    expect(diagnosticsCopy).toContain('Leviathan')
    expect(diagnosticsCopy).toContain('~/.leviathan.json')
  })

  test('runtime services and session comments use Leviathan terminology', () => {
    const runtimeServiceCopy = [
      source('ink/components/App.tsx'),
      source('ink/selection.ts'),
      source('migrations/resetAutoModeOptInForDefaultOffer.ts'),
      source('screens/REPL.tsx'),
      source('server/types.ts'),
      source('services/analytics/metadata.ts'),
      source('services/api/claude.ts'),
      source('services/api/errors.ts'),
      source('services/api/filesApi.ts'),
      source('services/api/firstTokenDate.ts'),
      source('services/api/withRetry.ts'),
      source('services/compact/compact.ts'),
      source('services/extractMemories/extractMemories.ts'),
      source('services/lsp/manager.ts'),
      source('services/MagicDocs/prompts.ts'),
      source('services/mcp/normalization.ts'),
      source('services/mcp/SdkControlTransport.ts'),
      source('services/mcp/types.ts'),
      source('services/mcp/useManageMCPConnections.ts'),
      source('services/mcp/utils.ts'),
      source('services/oauth/client.ts'),
      source('services/settingsSync/index.ts'),
      source('services/voiceStreamSTT.ts'),
      source('tasks/RemoteAgentTask/RemoteAgentTask.tsx'),
    ].join('\n')

    for (const removed of [
      'donk',
      'Claude.ai',
      'claude mcp add',
      '~/.claude',
      '.claude/',
      'Claude Code',
    ]) {
      expect(runtimeServiceCopy).not.toContain(removed)
    }
    expect(runtimeServiceCopy).toContain('Leviathan')
  })

  test('tool and permission source comments use Leviathan paths', () => {
    const toolPermissionCopy = [
      source('skills/loadSkillsDir.ts'),
      source('tools/BashTool/bashPermissions.ts'),
      source('tools/BashTool/BashTool.tsx'),
      source('tools/BashTool/pathValidation.ts'),
      source('tools/FileReadTool/FileReadTool.ts'),
      source('tools/PowerShellTool/modeValidation.ts'),
      source('tools/PowerShellTool/pathValidation.ts'),
      source('tools/PowerShellTool/powershellPermissions.ts'),
      source('tools/PowerShellTool/PowerShellTool.tsx'),
      source('tools/shared/spawnMultiAgent.ts'),
      source('types/ids.ts'),
      source('types/permissions.ts'),
    ].join('\n')

    for (const removed of [
      'donk',
      'Claude config directory',
      "Claude's permission config",
      '~/.claude',
      '.claude/',
    ]) {
      expect(toolPermissionCopy).not.toContain(removed)
    }
    expect(toolPermissionCopy).toContain('Leviathan')
    expect(toolPermissionCopy).toContain('~/.leviathan')
  })

  test('plugin source comments use Leviathan storage terminology', () => {
    const pluginCopy = [
      source('utils/plugins/installedPluginsManager.ts'),
      source('utils/plugins/loadPluginAgents.ts'),
      source('utils/plugins/marketplaceManager.ts'),
      source('utils/plugins/pluginFlagging.ts'),
      source('utils/plugins/pluginInstallationHelpers.ts'),
      source('utils/plugins/pluginLoader.ts'),
      source('utils/plugins/pluginOptionsStorage.ts'),
      source('utils/plugins/pluginVersioning.ts'),
      source('utils/plugins/refresh.ts'),
      source('utils/plugins/schemas.ts'),
      source('utils/plugins/validatePlugin.ts'),
    ].join('\n')

    for (const removed of ['donk', '~/.claude', '.claude/', 'Claude.ai']) {
      expect(pluginCopy).not.toContain(removed)
    }
    expect(pluginCopy).toContain('Leviathan')
    expect(pluginCopy).toContain('~/.leviathan')
  })

  test('permission, sandbox and swarm source comments use Leviathan paths', () => {
    const coordinationCopy = [
      source('utils/permissions/filesystem.ts'),
      source('utils/permissions/pathValidation.ts'),
      source('utils/permissions/permissions.ts'),
      source('utils/permissions/shadowedRuleDetection.ts'),
      source('utils/sandbox/sandbox-adapter.ts'),
      source('utils/settings/pluginOnlyPolicy.ts'),
      source('utils/swarm/backends/PaneBackendExecutor.ts'),
      source('utils/swarm/permissionSync.ts'),
      source('utils/swarm/teamHelpers.ts'),
      source('utils/swarm/teammateInit.ts'),
      source('utils/task/diskOutput.ts'),
    ].join('\n')

    for (const removed of ['donk', '~/.claude', '.claude/']) {
      expect(coordinationCopy).not.toContain(removed)
    }
    expect(coordinationCopy).toContain('Leviathan')
    expect(coordinationCopy).toContain('~/.leviathan')
  })

  test('top-level runtime entry source comments and help use Leviathan identity', () => {
    const entryCopy = [
      source('main.tsx'),
      source('setup.ts'),
      source('history.ts'),
      source('query.ts'),
      source('../preload.js'),
    ].join('\n')

    for (const removed of [
      'donk',
      'docs.claude.com',
      '~/.claude',
      '.claude/',
      'claude mcp',
      'claude.ai/code',
    ]) {
      expect(entryCopy).not.toContain(removed)
    }
    expect(entryCopy).toContain('Leviathan')
    expect(entryCopy).toContain('~/.leviathan/plugins/data/{id}/')
  })

  test('disabled cloud and browser account surfaces are Leviathan-neutralized', () => {
    const disabledSurfaces = [
      source('commands/chrome/chrome.tsx'),
      source('components/LeviathanBrowserOnboarding.tsx'),
      source('commands/feedback/index.ts'),
      source('commands/install-github-app/ApiKeyStep.tsx'),
      source('commands/install-github-app/install-github-app.tsx'),
      source('commands/install-github-app/OAuthFlowStep.tsx'),
      source('commands/install-github-app/setupGitHubActions.ts'),
      source('commands/passes/index.ts'),
      source('commands/remote-setup/index.ts'),
      source('commands/session/session.tsx'),
      source('commands/stickers/index.ts'),
      source('commands/ultraplan.tsx'),
      source('components/DesktopUpsell/DesktopUpsellStartup.tsx'),
      source('components/FeedbackSurvey/TranscriptSharePrompt.tsx'),
      source('components/LogoV2/GuestPassesUpsell.tsx'),
      source('components/Passes/Passes.tsx'),
      source('components/RemoteCallout.tsx'),
      source('components/RemoteEnvironmentDialog.tsx'),
      source('components/tasks/RemoteSessionDetailDialog.tsx'),
      source('components/WorkflowMultiselectDialog.tsx'),
      source('constants/github-app.ts'),
      source('hooks/notifs/useCanSwitchToExistingSubscription.tsx'),
      source('hooks/notifs/useNpmDeprecationNotification.tsx'),
      source('utils/leviathanBrowser/chromeNativeHost.ts'),
      source('utils/leviathanBrowser/common.ts'),
      source('utils/leviathanBrowser/mcpServer.ts'),
      source('utils/leviathanBrowser/prompt.ts'),
      source('utils/leviathanBrowser/setup.ts'),
      source('utils/leviathanBrowser/setupPortable.ts'),
      source('utils/leviathanBrowser/toolRendering.tsx'),
      source('utils/teleport.tsx'),
      source('utils/teleport/gitBundle.ts'),
    ].join('\n')

    for (const removed of [
      'donk',
      'Claude in Chrome',
      'Claude account',
      'Claude.ai',
      'Claude {subscriptionType}',
      'Anthropic look',
      'anthropics/claude',
      'claude-cli',
      'claude.ai subscription',
      'claude.com/claude-code',
      'code.claude.com',
      'docs.anthropic.com',
      'claude --chrome',
      'claude --remote',
      'claude --teleport',
      'claude.ai/code',
      "value: 'claude' as const",
      "value: 'claude-review' as const",
      'Claude app',
      'Claude browser extension',
      'claude.ai with the same account as donk',
    ]) {
      expect(disabledSurfaces).not.toContain(removed)
    }
    expect(disabledSurfaces).toContain('Leviathan')
  })

  test('runtime errors and disabled remote tools do not expose recovered product names', () => {
    const runtimeTooling = [
      source('utils/autoUpdater.ts'),
      source('tools/RemoteTriggerTool/prompt.ts'),
      source('utils/teleport/environments.ts'),
      source('tasks/RemoteAgentTask/RemoteAgentTask.tsx'),
      source('skills/bundled/scheduleRemoteAgents.ts'),
      source('utils/settings/validateEditTool.ts'),
      source('utils/task/TaskOutput.ts'),
    ].join('\n')

    for (const removed of [
      'version of donk',
      'donk in WSL',
      'claude update',
      'remote donk agents',
      'claude.ai CCR API',
      'Claude.ai account',
      'sign in with your Claude.ai account',
      'donk process',
      'donk settings.json validation failed',
      'https://storage.googleapis.com/claude-code-dist',
    ]) {
      expect(runtimeTooling).not.toContain(removed)
    }
    expect(runtimeTooling).toContain('Leviathan')
  })

  test('local cache, docs and edit permission constants use Leviathan roots', () => {
    const localRoots = [
      source('utils/cachePaths.ts'),
      source('constants/prompts.ts'),
      source('tools/FileEditTool/constants.ts'),
      source('services/settingsSync/types.ts'),
      source('outputStyles/loadOutputStylesDir.ts'),
      source('utils/releaseNotes.ts'),
    ].join('\n')

    for (const removed of [
      "envPaths('claude-cli')",
      'https://code.claude.com/docs/en/claude_code_docs_map.md',
      "'/.claude/**'",
      "'~/.claude/**'",
      '~/.claude/settings.json',
      '~/.claude/CLAUDE.md',
      '.claude/output-styles',
      'github.com/anthropics/claude-code',
      'raw.githubusercontent.com/anthropics/claude-code',
    ]) {
      expect(localRoots).not.toContain(removed)
    }
    expect(localRoots).toContain("envPaths('leviathan-code')")
    expect(localRoots).toContain('https://leviathan.local/docs/map.md')
    expect(localRoots).toContain('.leviathan/output-styles')
  })

  test('worktree tool prompts use Leviathan workspace paths', () => {
    const worktreePrompt = source('tools/EnterWorktreeTool/prompt.ts')

    expect(worktreePrompt).toContain('.leviathan/worktrees/')
    expect(worktreePrompt).not.toContain('.claude/worktrees/')
  })

  test('bundled skills and keybinding docs use Leviathan paths and docs', () => {
    const skillDocs = [
      source('skills/bundled/debug.ts'),
      source('skills/bundled/skillify.ts'),
      source('skills/bundled/keybindings.ts'),
      source('skills/bundled/providerApi.ts'),
      source('skills/bundled/providerApiContent.ts'),
      source('keybindings/template.ts'),
      source('keybindings/schema.ts'),
      source('keybindings/reservedShortcuts.ts'),
      source('keybindings/defaultBindings.ts'),
      source('keybindings/loadUserBindings.ts'),
      source('keybindings/KeybindingProviderSetup.tsx'),
    ].join('\n')

    for (const removed of [
      'donk',
      'https://code.claude.com/docs/en/keybindings',
      '.claude/skills/<name>/SKILL.md',
      '~/.claude/skills/<name>/SKILL.md',
      '~/.claude/keybindings.json',
      'when Claude should automatically invoke',
      'claude --debug',
      '/claude-api',
      'claude-api',
      "name: 'claude-api'",
      'Build apps with the Claude API',
      'tengu_keybinding_customization_release',
      'Anthropic employees',
      '[ANT-ONLY]',
      '[ant-only]',
    ]) {
      expect(skillDocs).not.toContain(removed)
    }
    expect(skillDocs).toContain('Leviathan')
    expect(skillDocs).toContain('.leviathan/skills/<name>/SKILL.md')
    expect(skillDocs).toContain("name: 'provider-api'")
    expect(skillDocs).toContain('return true')
  })

  test('memory prompts and default paths use Leviathan identity', () => {
    const memorySources = [
      source('memdir/paths.ts'),
      source('memdir/findRelevantMemories.ts'),
      source('memdir/memdir.ts'),
      source('memdir/memoryTypes.ts'),
    ].join('\n')

    for (const removed of [
      'donk',
      '.claude',
      '~/.claude',
      'Claude reads',
      'getClaudeConfigHomeDir',
    ]) {
      expect(memorySources).not.toContain(removed)
    }
    expect(memorySources).toContain('Leviathan')
    expect(memorySources).toContain('getLeviathanConfigHomeDir')
  })

  test('status notices do not show legacy account or official IDE prompts', () => {
    const statusNotices = source('utils/statusNoticeDefinitions.tsx')

    for (const removed of [
      'Claude account',
      'claude /logout',
      'claude.ai',
      'docs.claude.com',
      'Anthropic Console key',
      'claude-code-jetbrains',
      'claudeAiSubscriberExternalTokenNotice',
      'jetbrainsPluginNotice',
    ]) {
      expect(statusNotices).not.toContain(removed)
    }
  })

  test('doctor screen reports Leviathan diagnostics and local paths', () => {
    const doctor = source('screens/Doctor.tsx')

    expect(doctor).toContain('Leviathan diagnostics dismissed')
    expect(doctor).toContain('".leviathan", "agents"')
    expect(doctor).toContain('"leviathan", "locks"')
    for (const removed of [
      'donk diagnostics dismissed',
      "getClaudeConfigHomeDir(), \"agents\"",
      "'.claude', \"agents\"",
      '"claude", "locks"',
    ]) {
      expect(doctor).not.toContain(removed)
    }
  })

  test('agent creation wizard and persistent memory use Leviathan paths', () => {
    const agentCreation = [
      source('components/agents/new-agent-creation/wizard-steps/LocationStep.tsx'),
      source('components/agents/new-agent-creation/wizard-steps/MemoryStep.tsx'),
      source('components/agents/new-agent-creation/wizard-steps/ConfirmStep.tsx'),
      source('components/agents/new-agent-creation/wizard-steps/MethodStep.tsx'),
      source('components/agents/AgentDetail.tsx'),
      source('components/agents/types.ts'),
      source('components/agents/agentFileUtils.ts'),
      source('tools/AgentTool/agentMemory.ts'),
      source('tools/AgentTool/agentMemorySnapshot.ts'),
    ].join('\n')

    for (const removed of [
      '~/.claude/agents/',
      '.claude/agents/',
      '~/.claude/agent-memory/',
      '.claude/agent-memory/',
      '.claude/agent-memory-local/',
      'Generate with Claude',
      'tells Claude',
      "FOLDER_NAME: '.claude'",
      "join(getOriginalCwd(), '.claude', 'agents')",
    ]) {
      expect(agentCreation).not.toContain(removed)
    }
    expect(agentCreation).toContain('~/.leviathan/agents/')
    expect(agentCreation).toContain("FOLDER_NAME: '.leviathan'")
    expect(agentCreation).toContain('.leviathan/agent-memory/')
  })

  test('local runtime comments use Leviathan storage and session terminology', () => {
    const localRuntime = [
      source('utils/config.ts'),
      source('utils/cleanup.ts'),
      source('utils/caCertsConfig.ts'),
      source('utils/json.ts'),
      source('utils/hooks.ts'),
      source('utils/git.ts'),
      source('utils/managedEnv.ts'),
      source('utils/managedEnvConstants.ts'),
      source('utils/memoryFileDetection.ts'),
      source('utils/sessionStoragePortable.ts'),
      source('utils/settings/settings.ts'),
      source('utils/settings/mdm/settings.ts'),
      source('utils/teamDiscovery.ts'),
      source('utils/teammateMailbox.ts'),
      source('utils/teammate.ts'),
      source('utils/telemetry/sessionTracing.ts'),
      source('utils/telemetry/perfettoTracing.ts'),
      source('utils/telemetry/betaSessionTracing.ts'),
      source('utils/terminalPanel.ts'),
      source('utils/tmuxSocket.ts'),
      source('utils/privacyLevel.ts'),
      source('utils/systemPrompt.ts'),
      source('utils/editor.ts'),
      source('utils/fingerprint.ts'),
      source('utils/filePersistence/filePersistence.ts'),
      source('utils/hooks/skillImprovement.ts'),
      source('utils/computerUse/common.ts'),
      source('utils/undercover.ts'),
    ].join('\n')

    for (const removed of [
      'donk',
      '~/.claude/cache/changelog.md',
      '~/.claude/debug/',
      '~/.claude/settings.json',
      '~/.claude.json',
      '.claude/settings.json',
      '.claude/rules/*.md',
      '~/.claude/projects/',
      '~/.claude/ide',
      '/etc/claude-code/managed-settings.json',
      '~/.claude/teams/',
      '.claude/teams/{team_name}',
      '~/.claude/traces',
      'claude-cli-internal',
      'anthropics/claude-code',
      '#claude-code-',
      'Generated with donk',
      'com.anthropic.claude-code.cli-no-window',
      'Claude.ai',
    ]) {
      expect(localRuntime).not.toContain(removed)
    }
    expect(localRuntime).toContain('Leviathan')
  })

  test('entry, IDE and shell hint protocols are Leviathan-owned', () => {
    const protocolSources = [
      source('main.tsx'),
      source('utils/ide.ts'),
      source('utils/settings/managedPath.ts'),
      source('utils/leviathanHints.ts'),
      source('hooks/useLeviathanHintRecommendation.tsx'),
      source('hooks/usePluginRecommendationBase.tsx'),
      source('tools/BashTool/BashTool.tsx'),
      source('tools/PowerShellTool/PowerShellTool.tsx'),
      source('utils/plugins/hintRecommendation.ts'),
    ].join('\n')

    for (const removed of [
      'com.anthropic.claude-code-url-handler',
      'anthropic.claude-code',
      'anthropic.claude-code-internal',
      '/etc/claude-code',
      '~/.claude/ide',
      '<claude-code-hint',
      'docs/claude-code-hints.md',
      'claude-code-hint',
      'donk',
    ]) {
      expect(protocolSources).not.toContain(removed)
    }
    expect(protocolSources).toContain('com.leviathan.code-url-handler')
    expect(protocolSources).toContain('/etc/leviathan-code')
    expect(protocolSources).toContain('<leviathan-code-hint')
  })

  test('migration, worktree and diagnostic comments do not advertise recovered origins', () => {
    const migrationSources = [
      source('entrypoints/mcp.ts'),
      source('services/api/claude.ts'),
      source('services/lsp/manager.ts'),
      source('services/mcp/auth.ts'),
      source('skills/loadSkillsDir.ts'),
      source('utils/api.ts'),
      source('utils/attachments.ts'),
      source('utils/background/remote/preconditions.ts'),
      source('utils/leviathanmd.ts'),
      source('utils/commitAttribution.ts'),
      source('utils/envUtils.ts'),
      source('utils/fsOperations.ts'),
      source('utils/markdownConfigLoader.ts'),
      source('utils/model/agent.ts'),
      source('utils/model/model.ts'),
      source('utils/nativeInstaller/packageManagers.ts'),
      source('utils/queryHelpers.ts'),
      source('utils/secureStorage/fallbackStorage.ts'),
      source('utils/settings/changeDetector.ts'),
      source('utils/stats.ts'),
      source('utils/toolSearch.ts'),
      source('utils/worktree.ts'),
      source('utils/worktreeModeEnabled.ts'),
    ].join('\n')

    for (const removed of [
      'github.com/anthropics/claude-code',
      'Claude.ai',
      'claude-cli-internal',
      'donk',
      '.claude/worktrees',
      '`claude -w`',
      'Historical CLAUDE.md and .claude/rules',
      'Try reading .claude/rules/*.md files',
      'Process project unconditional .claude/rules/*.md files',
      'Processes all .md files in the .claude/rules/',
      '/opt/homebrew/Caskroom/claude-code/',
    ]) {
      expect(migrationSources).not.toContain(removed)
    }
    expect(migrationSources).toContain('.leviathan/worktrees')
    expect(migrationSources).toContain('Leviathan')
  })

  test('remote credential fallbacks use Leviathan-owned runtime paths', () => {
    const remoteCredentialSources = [
      source('utils/authFileDescriptor.ts'),
      source('utils/sessionIngressAuth.ts'),
      source('utils/swarm/spawnUtils.ts'),
      source(
        'types/generated/events_mono/claude_code/v1/claude_code_internal_event.ts',
      ),
    ].join('\n')

    for (const removed of [
      '/home/claude/.claude/remote',
      'claude-cli-internal',
      'events logged from donk',
      'structure in claude-cli-internal',
    ]) {
      expect(remoteCredentialSources).not.toContain(removed)
    }
    expect(remoteCredentialSources).toContain(
      '/home/leviathan/.leviathan/remote',
    )
  })

  test('remaining visible workflow text does not point at Claude account products', () => {
    const workflowText = [
      source('voice/voiceModeEnabled.ts'),
      source('components/DesktopHandoff.tsx'),
      source('components/agents/AgentsList.tsx'),
      source('commands/branch/branch.ts'),
      source('cli/print.ts'),
      source('bridge/bridgeMain.ts'),
      source('bridge/types.ts'),
      source('hooks/useChromeExtensionNotification.tsx'),
      source('components/LogoV2/ChannelsNotice.tsx'),
      source('commands/voice/voice.ts'),
      source('commands/extra-usage/extra-usage-core.ts'),
      source('commands/review/ultrareviewCommand.tsx'),
      source('services/api/errors.ts'),
    ].join('\n')

    for (const removed of [
      'Claude can delegate',
      'Claude Desktop',
      'Claude in Chrome',
      'https://claude.ai',
      'claude.ai',
      'claude -r',
      'claude -p --resume',
      'claude.ai sees',
      'run `claude`',
      "tmpdir(), 'claude'",
      'Anthropic OAuth',
      'isAnthropicAuthEnabled',
      'getClaudeAIOAuthTokens',
      'Claude Opus is not available',
    ]) {
      expect(workflowText).not.toContain(removed)
    }
    expect(workflowText).toContain('Leviathan')
  })

  test('desktop handoff and import surfaces use Leviathan Desktop identity', () => {
    const desktopText = [
      source('utils/desktopDeepLink.ts'),
      source('utils/claudeDesktop.ts'),
      source('commands/desktop/index.ts'),
      source('components/MCPServerDesktopImportDialog.tsx'),
    ].join('\n')

    for (const removed of [
      'Claude Desktop',
      '/Applications/Claude.app',
      'AnthropicClaude',
      'https://claude.ai/download',
      'claude://resume',
      'claude-dev://resume',
      'x-scheme-handler/claude',
      'HKEY_CLASSES_ROOT\\\\claude',
    ]) {
      expect(desktopText).not.toContain(removed)
    }
    expect(desktopText).toContain('Leviathan Desktop')
  })

  test('channel, remote trigger and privacy setup surfaces do not require claude.ai account flows', () => {
    const accountFlowText = [
      source('interactiveHelpers.tsx'),
      source('services/mcp/channelNotification.ts'),
      source('services/mcp/useManageMCPConnections.ts'),
      source('tools/RemoteTriggerTool/RemoteTriggerTool.ts'),
      source('hooks/useApiKeyVerification.ts'),
      source('components/grove/Grove.tsx'),
    ].join('\n')

    for (const removed of [
      'claude.ai authentication',
      'Not authenticated with a claude.ai account',
      'https://claude.ai/settings/data-privacy-controls',
      'Help improve Claude',
      'Allow the use of your chats and coding sessions to train and improve Anthropic AI models',
      'getClaudeAIOAuthTokens',
      'isAnthropicAuthEnabled',
    ]) {
      expect(accountFlowText).not.toContain(removed)
    }
    expect(accountFlowText).toContain('Leviathan')
  })

  test('bridge and MCP connector compatibility paths use Leviathan-neutral wording', () => {
    const compatibilityText = [
      source('hooks/useReplBridge.tsx'),
      source('commands/bridge/bridge.tsx'),
      source('hooks/useRemoteSession.ts'),
      source('hooks/toolPermission/handlers/interactiveHandler.ts'),
      source('services/tools/toolExecution.ts'),
      source('services/mcp/channelNotification.ts'),
      source('services/mcp/config.ts'),
      source('services/mcp/useManageMCPConnections.ts'),
      source('services/mcp/normalization.ts'),
      source('services/mcp/utils.ts'),
      source('services/analytics/metadata.ts'),
    ].join('\n')

    for (const removed of [
      'claude.ai',
      'Claude mobile app',
      'Claude as normal chat',
      'ClaudeCodeInternalEvent',
    ]) {
      expect(compatibilityText).not.toContain(removed)
    }
    expect(compatibilityText).toContain('Leviathan')
  })

  test('remaining bridge, SDK, MCP and mobile surfaces do not advertise recovered account hosts', () => {
    const cloudSurfaceText = [
      source('cli/structuredIO.ts'),
      source('bridge/bridgeMessaging.ts'),
      source('bridge/bridgeEnabled.ts'),
      source('bridge/bridgeApi.ts'),
      source('bridge/initReplBridge.ts'),
      source('bridge/replBridgeTransport.ts'),
      source('bridge/replBridge.ts'),
      source('entrypoints/sdk/coreSchemas.ts'),
      source('entrypoints/agentSdkTypes.ts'),
      source('state/AppStateStore.ts'),
      source('main.tsx'),
      source('types/command.ts'),
      source('tools/MCPTool/UI.tsx'),
      source('tools/MCPTool/classifyForCollapse.ts'),
      source('tools/McpAuthTool/McpAuthTool.ts'),
      source('tasks/RemoteAgentTask/RemoteAgentTask.tsx'),
      source('utils/deepLink/banner.ts'),
      source('utils/plugins/marketplaceManager.ts'),
      source('utils/plugins/pluginBlocklist.ts'),
      source('utils/settings/types.ts'),
      source('utils/nativeInstaller/download.ts'),
      source('commands/mobile/index.ts'),
    ].join('\n')

    for (const removed of [
      'claude.ai',
      'Claude mobile app',
      'downloads.claude.ai',
      'claude-code-releases',
    ]) {
      expect(cloudSurfaceText).not.toContain(removed)
    }
    expect(cloudSurfaceText).toContain('Leviathan')
  })

  test('telemetry runtime identities are Leviathan-owned', () => {
    const telemetryText = [
      source('services/analytics/datadog.ts'),
      source('services/analytics/firstPartyEventLogger.ts'),
      source('services/analytics/firstPartyEventLoggingExporter.ts'),
      source('services/analytics/metadata.ts'),
      source('utils/subprocessEnv.ts'),
      source('utils/telemetry/events.ts'),
      source('utils/telemetry/instrumentation.ts'),
      source('utils/telemetry/sessionTracing.ts'),
    ].join('\n')

    for (const removed of [
      'com.anthropic.claude_code',
      "'claude-code'",
      '"claude-code"',
      '`claude_code.${eventName}`',
      'claude_code.interaction',
      'claude_code.llm_request',
      'claude_code.tool',
      'claude_code.hook',
      'claude-code-action',
    ]) {
      expect(telemetryText).not.toContain(removed)
    }
    expect(telemetryText).toContain('leviathan-code')
    expect(telemetryText).toContain('com.leviathan.code')
  })

  test('workflow prompts, action entrypoints and counters are Leviathan-owned', () => {
    const workflowText = [
      source('commands/commit-push-pr.ts'),
      source('coordinator/coordinatorMode.ts'),
      source('constants/prompts.ts'),
      source('bootstrap/state.ts'),
      source('main.tsx'),
      source('commands/remote-setup/remote-setup.tsx'),
      source('commands/remote-setup/api.ts'),
    ].join('\n')

    for (const removed of [
      'anthropics/claude-code',
      'mcp__claude_ai_Slack__slack_send_message',
      'user\'s CLAUDE.md mentions',
      'durable instructions like CLAUDE.md files',
      'claude-code-github-action',
      'CLAUDE.md-injected',
      'CLAUDE.md content',
      'CLAUDE.md loading',
      "'claude_code.session.count'",
      "'claude_code.lines_of_code.count'",
      "'claude_code.pull_request.count'",
      "'claude_code.commit.count'",
      "'claude_code.cost.usage'",
      "'claude_code.token.usage'",
      "'claude_code.code_edit_tool.decision'",
      "'claude_code.active_time.total'",
      'Not signed in to Claude',
      'Connecting GitHub to Claude',
      'Connect Claude on the web to GitHub?',
      'Claude on the web requires',
    ]) {
      expect(workflowText).not.toContain(removed)
    }
    expect(workflowText).toContain('LEVIATHAN.md')
    expect(workflowText).toContain('leviathan-code-github-action')
    expect(workflowText).toContain('leviathan_code.session.count')
  })

  test('auxiliary prompts and MCP server identity use Leviathan naming', () => {
    const auxiliaryText = [
      source('constants/outputStyles.ts'),
      source('tools/WebSearchTool/prompt.ts'),
      source('tools/SendMessageTool/prompt.ts'),
      source('tools/SendMessageTool/SendMessageTool.ts'),
      source('components/FeedbackSurvey/FeedbackSurveyView.tsx'),
      source('entrypoints/mcp.ts'),
    ].join('\n')

    for (const removed of [
      "name: 'claude/tengu'",
      'Local Claude session',
      'receiving Claude',
      "Anthropic's servers",
      'Allows Claude',
      "Claude's knowledge cutoff",
      'Claude explains its implementation choices',
      'Claude pauses and asks',
      'How is Claude doing this session?',
    ]) {
      expect(auxiliaryText).not.toContain(removed)
    }
    expect(auxiliaryText).toContain("name: 'leviathan/tengu'")
    expect(auxiliaryText).toContain('Leviathan explains its implementation choices')
  })

  test('local agent and safety prompts avoid recovered project names', () => {
    const localPromptText = [
      source('tools/AgentTool/built-in/verificationAgent.ts'),
      source('constants/cyberRiskInstruction.ts'),
      source('constants/prompts.ts'),
      source('constants/xml.ts'),
      source('QueryEngine.ts'),
      source('query.ts'),
      source('screens/REPL.tsx'),
      source('utils/concurrentSessions.ts'),
      source('types/logs.ts'),
      source('utils/sessionStorage.ts'),
    ].join('\n')

    for (const removed of [
      'mcp__claude-in-chrome__*',
      "project's CLAUDE.md / README",
      'does CLAUDE.md / comments',
      "Claude's behavior",
      'How Claude handles penetration testing',
      'What security tools and techniques Claude will assist with',
      'Claude: Do not edit this file',
      'where Claude can write temporary files',
      "another Claude session's inbox",
      'Sends a single prompt to the Claude API',
      'claude is being used non-interactively',
      'so Claude can respond to them',
      'claude ps',
    ]) {
      expect(localPromptText).not.toContain(removed)
    }
    expect(localPromptText).toContain('LEVIATHAN.md / README')
    expect(localPromptText).toContain('Leviathan can write temporary files')
  })

  test('bundled browser automation guidance is Leviathan-neutral', () => {
    const browserSkillText = [
      source('entrypoints/cli.tsx'),
      source('services/mcp/client.ts'),
      source('services/mcp/config.ts'),
      source('plugins/bundled/index.ts'),
      source('skills/bundled/batch.ts'),
      source('skills/bundled/leviathanBrowser.ts'),
      source('utils/mcpInstructionsDelta.ts'),
      source('utils/leviathanBrowser/common.ts'),
      source('utils/leviathanBrowser/mcpServer.ts'),
      source('utils/leviathanBrowser/prompt.ts'),
      source('utils/leviathanBrowser/setup.ts'),
      source('utils/leviathanBrowser/toolRendering.tsx'),
    ].join('\n')

    for (const removed of [
      '@ant/claude-for-chrome-mcp',
      'ClaudeForChrome',
      'getClaudeAIOAuthTokens',
      'bridge.claudeusercontent.com',
      'clau.de/chrome',
      'claude-mcp-browser-bridge',
      '--claude-in-chrome-mcp',
      'claude-in-chrome',
      'mcp__claude-in-chrome__*',
      'mcp__claude-in-chrome__',
      'skill: "claude-in-chrome"',
      'Skill(skill: "claude-in-chrome")',
      "name: 'claude-in-chrome'",
    ]) {
      expect(browserSkillText).not.toContain(removed)
    }
    expect(browserSkillText).toContain('Leviathan browser automation')
  })

  test('low-level product constants and voice surfaces do not point at recovered account hosts', () => {
    const lowLevelText = [
      source('constants/product.ts'),
      source('constants/oauth.ts'),
      source('services/voiceStreamSTT.ts'),
      source('hooks/useVoiceEnabled.ts'),
      source('utils/config.ts'),
      source('utils/sanitization.ts'),
    ].join('\n')
    const authText = source('utils/auth.ts')

    for (const removed of [
      'https://claude.ai',
      'claude.ai',
      'Claude Desktop',
      'Claude in Chrome',
      'getClaudeAIOAuthTokens',
      'isAnthropicAuthEnabled',
      'claude.ai frontend',
      'claude.ai web origin',
    ]) {
      expect(lowLevelText).not.toContain(removed)
    }
    expect(lowLevelText).toContain('Leviathan')
    expect(authText).not.toContain('Claude Desktop')
  })

  test('distribution, IDE and schema constants use Leviathan-owned names', () => {
    const residualConstantText = [
      source('constants/oauth.ts'),
      source('components/PackageManagerAutoUpdater.tsx'),
      source('utils/jetbrains.ts'),
      source('utils/screenshotClipboard.ts'),
      source('utils/settings/constants.ts'),
      source('services/api/grove.ts'),
    ].join('\n')

    for (const removed of [
      'app=claude-code',
      'brew upgrade claude-code',
      'winget upgrade Anthropic.ClaudeCode',
      'apk upgrade claude-code',
      'claude-code-jetbrains-plugin',
      'claude-code-screenshots',
      'claude-code-settings.json',
      '/api/claude_code_grove',
    ]) {
      expect(residualConstantText).not.toContain(removed)
    }
    expect(residualConstantText).toContain('leviathan-code-settings.json')
    expect(residualConstantText).toContain('leviathan-code-screenshots')
  })
})
