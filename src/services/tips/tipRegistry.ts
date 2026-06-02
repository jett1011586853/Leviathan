import chalk from 'chalk'
import { shouldOfferTerminalSetup } from '../../commands/terminalSetup/terminalSetup.js'
import { getShortcutDisplay } from '../../keybindings/shortcutFormat.js'
import { getGlobalConfig } from '../../utils/config.js'
import { env } from '../../utils/env.js'
import { fileHistoryEnabled } from '../../utils/fileHistory.js'
import { getPlatform } from '../../utils/platform.js'
import {
  getInitialSettings,
  getSettings_DEPRECATED,
} from '../../utils/settings/settings.js'
import { getSessionsSinceLastShown } from './tipHistory.js'
import type { Tip, TipContext } from './types.js'

const localTips: Tip[] = [
  {
    id: 'new-user-warmup',
    content: async () =>
      'Start with a small change, ask Leviathan for a plan, and verify the resulting edits.',
    cooldownSessions: 3,
    isRelevant: async () => getGlobalConfig().numStartups < 10,
  },
  {
    id: 'plan-mode-for-complex-tasks',
    content: async () =>
      `Use Plan Mode to prepare a complex change before editing. Press ${getShortcutDisplay('chat:cycleMode', 'Chat', 'shift+tab')} twice to enable it.`,
    cooldownSessions: 5,
    isRelevant: async () => {
      const lastUse = getGlobalConfig().lastPlanModeUse
      const daysSinceLastUse = lastUse
        ? (Date.now() - lastUse) / (1000 * 60 * 60 * 24)
        : Infinity
      return daysSinceLastUse > 7
    },
  },
  {
    id: 'default-permission-mode-config',
    content: async () =>
      'Use /config to choose your default permission mode, including Plan Mode.',
    cooldownSessions: 10,
    isRelevant: async () =>
      Boolean(getGlobalConfig().lastPlanModeUse) &&
      !getSettings_DEPRECATED().permissions?.defaultMode,
  },
  {
    id: 'terminal-setup',
    content: async () =>
      env.terminal === 'Apple_Terminal'
        ? 'Run /terminal-setup to enable Option+Enter for new lines.'
        : 'Run /terminal-setup to enable Shift+Enter for new lines.',
    cooldownSessions: 10,
    isRelevant: async () => shouldOfferTerminalSetup(),
  },
  {
    id: 'shift-enter',
    content: async () =>
      env.terminal === 'Apple_Terminal'
        ? 'Press Option+Enter to send a multi-line message.'
        : 'Press Shift+Enter to send a multi-line message.',
    cooldownSessions: 10,
    isRelevant: async () => {
      const config = getGlobalConfig()
      return Boolean(
        (env.terminal === 'Apple_Terminal'
          ? config.optionAsMetaKeyInstalled
          : config.shiftEnterKeyBindingInstalled) && config.numStartups > 3,
      )
    },
  },
  {
    id: 'memory-command',
    content: async () => 'Use /memory to view and manage Leviathan memory.',
    cooldownSessions: 15,
    isRelevant: async () => getGlobalConfig().memoryUsageCount <= 0,
  },
  {
    id: 'theme-command',
    content: async () => 'Use /theme to change the color theme.',
    cooldownSessions: 20,
    isRelevant: async () => true,
  },
  {
    id: 'colorterm-truecolor',
    content: async () =>
      'Set COLORTERM=truecolor to enable richer terminal colors.',
    cooldownSessions: 30,
    isRelevant: async () => !process.env.COLORTERM && chalk.level < 3,
  },
  {
    id: 'status-line',
    content: async () =>
      'Use /statusline to configure a status line beneath the input box.',
    cooldownSessions: 25,
    isRelevant: async () => getSettings_DEPRECATED().statusLine === undefined,
  },
  {
    id: 'prompt-queue',
    content: async () =>
      'Press Enter to queue additional messages while Leviathan is working.',
    cooldownSessions: 5,
    isRelevant: async () => getGlobalConfig().promptQueueUseCount <= 3,
  },
  {
    id: 'todo-list',
    content: async () =>
      'Ask Leviathan to track a checklist for complex tasks.',
    cooldownSessions: 20,
    isRelevant: async () => true,
  },
  {
    id: 'permissions',
    content: async () =>
      'Use /permissions to pre-approve or pre-deny bash, edit, and MCP tools.',
    cooldownSessions: 10,
    isRelevant: async () => getGlobalConfig().numStartups > 10,
  },
  {
    id: 'drag-and-drop-images',
    content: async () => 'Drag image files into the terminal to attach them.',
    cooldownSessions: 10,
    isRelevant: async () => !env.isSSH(),
  },
  {
    id: 'paste-images-mac',
    content: async () =>
      'Paste images into Leviathan with Control+V instead of Command+V.',
    cooldownSessions: 10,
    isRelevant: async () => getPlatform() === 'macos',
  },
  {
    id: 'double-esc',
    content: async () =>
      fileHistoryEnabled()
        ? 'Double-tap Esc to rewind code and conversation state.'
        : 'Double-tap Esc to rewind the conversation.',
    cooldownSessions: 10,
    isRelevant: async () => true,
  },
  {
    id: 'rename-conversation',
    content: async () =>
      'Name conversations with /rename so they are easier to find in /resume.',
    cooldownSessions: 15,
    isRelevant: async () => getGlobalConfig().numStartups > 10,
  },
  {
    id: 'shift-tab',
    content: async () =>
      `Press ${getShortcutDisplay('chat:cycleMode', 'Chat', 'shift+tab')} to cycle interaction modes.`,
    cooldownSessions: 10,
    isRelevant: async () => true,
  },
  {
    id: 'image-paste',
    content: async () =>
      `Use ${getShortcutDisplay('chat:imagePaste', 'Chat', 'ctrl+v')} to paste an image from the clipboard.`,
    cooldownSessions: 20,
    isRelevant: async () => true,
  },
  {
    id: 'custom-agents',
    content: async () => 'Use /agents to create specialized task agents.',
    cooldownSessions: 15,
    isRelevant: async () => getGlobalConfig().numStartups > 5,
  },
]

function getCustomTips(): Tip[] {
  const override = getInitialSettings().spinnerTipsOverride
  if (!override?.tips?.length) return []

  return override.tips.map((content, index) => ({
    id: `custom-tip-${index}`,
    content: async () => content,
    cooldownSessions: 0,
    isRelevant: async () => true,
  }))
}

export async function getRelevantTips(_context?: TipContext): Promise<Tip[]> {
  const override = getInitialSettings().spinnerTipsOverride
  const customTips = getCustomTips()

  if (override?.excludeDefault && customTips.length > 0) {
    return customTips
  }

  const relevance = await Promise.all(localTips.map(tip => tip.isRelevant()))
  const available = localTips
    .filter((_, index) => relevance[index])
    .filter(tip => getSessionsSinceLastShown(tip.id) >= tip.cooldownSessions)

  return [...available, ...customTips]
}
