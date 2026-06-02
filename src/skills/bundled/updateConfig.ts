import { toJSONSchema } from 'zod/v4'
import { SettingsSchema } from '../../utils/settings/types.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { registerBundledSkill } from '../bundledSkills.js'

function generateSettingsSchema(): string {
  const jsonSchema = toJSONSchema(SettingsSchema(), { io: 'input' })
  return jsonStringify(jsonSchema, null, 2)
}

const SETTINGS_EXAMPLES_DOCS = `## Settings File Locations

Choose the appropriate file based on scope:

| File | Scope | Git | Use For |
|------|-------|-----|---------|
| \`~/.leviathan/settings.json\` | Global | N/A | Personal preferences for all projects |
| \`.leviathan/settings.json\` | Project | Commit | Team-wide hooks, permissions, plugins |
| \`.leviathan/settings.local.json\` | Project | Gitignore | Personal overrides for this project |

Leviathan reads legacy settings for migration, but new edits should go to the paths above. Settings load in order: user -> project -> local, with later sources overriding earlier ones.

### Permissions
\`\`\`json
{
  "permissions": {
    "allow": ["Bash(npm:*)", "Edit(.leviathan)", "Read"],
    "deny": ["Bash(rm -rf:*)"],
    "ask": ["Write(/etc/*)"],
    "defaultMode": "default",
    "additionalDirectories": ["/extra/dir"]
  }
}
\`\`\`

### Environment Variables
\`\`\`json
{
  "env": {
    "DEBUG": "true",
    "MY_API_KEY": "value"
  }
}
\`\`\`

### Model And Agent
\`\`\`json
{
  "model": "sonnet",
  "agent": "agent-name",
  "alwaysThinkingEnabled": true
}
\`\`\`

### MCP Server Management
\`\`\`json
{
  "enableAllProjectMcpServers": true,
  "enabledMcpjsonServers": ["server1", "server2"],
  "disabledMcpjsonServers": ["blocked-server"]
}
\`\`\`

### Plugins
\`\`\`json
{
  "enabledPlugins": {
    "formatter@team-tools": true
  }
}
\`\`\`

Plugin syntax: \`plugin-name@source\`, where \`source\` is a configured marketplace name or \`builtin\`.
`

const HOOKS_DOCS = `## Hooks Configuration

Hooks run commands at specific points in Leviathan's lifecycle.

### Hook Structure
\`\`\`json
{
  "hooks": {
    "EVENT_NAME": [
      {
        "matcher": "ToolName|OtherTool",
        "hooks": [
          {
            "type": "command",
            "command": "your-command-here",
            "timeout": 60,
            "statusMessage": "Running..."
          }
        ]
      }
    ]
  }
}
\`\`\`

### Hook Events

| Event | Matcher | Purpose |
|-------|---------|---------|
| PermissionRequest | Tool name | Run before permission prompt |
| PreToolUse | Tool name | Run before tool, can block |
| PostToolUse | Tool name | Run after successful tool |
| PostToolUseFailure | Tool name | Run after tool fails |
| Notification | Notification type | Run on notifications |
| Stop | - | Run when Leviathan stops, including clear, resume, and compact |
| PreCompact | "manual"/"auto" | Before compaction |
| PostCompact | "manual"/"auto" | After compaction |
| UserPromptSubmit | - | When the user submits |
| SessionStart | - | When the session starts |

Common tool matchers: \`Bash\`, \`Write\`, \`Edit\`, \`Read\`, \`Glob\`, \`Grep\`.

### Common Patterns

Auto-format after writes:
\`\`\`json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Write|Edit",
      "hooks": [{
        "type": "command",
        "command": "jq -r '.tool_response.filePath // .tool_input.file_path' | { read -r f; prettier --write \\"$f\\"; } 2>/dev/null || true"
      }]
    }]
  }
}
\`\`\`

Log all bash commands:
\`\`\`json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Bash",
      "hooks": [{
        "type": "command",
        "command": "jq -r '.tool_input.command' >> ~/.leviathan/bash-log.txt"
      }]
    }]
  }
}
\`\`\`
`

const HOOK_VERIFICATION_FLOW = `## Constructing A Hook

1. Read the target settings file first. If a hook already exists on the same event and matcher, show it and ask whether to keep it, replace it, or add alongside it.
2. Build the command for this project. The hook receives JSON on stdin; extract values safely with \`jq -r\` into quoted variables.
3. Pipe-test the raw command with representative JSON before writing it to settings.
4. Merge into \`.leviathan/settings.json\` or \`.leviathan/settings.local.json\`. If this creates the local file for the first time, add it to .gitignore.
5. Validate JSON syntax and the hook shape. A malformed settings file disables all settings from that file.
6. Prove the hook fires when practical. For write/edit hooks, trigger a small reversible edit and confirm the side effect.
7. If the hook is correct but does not fire in this session, tell the user to open \`/hooks\` once or restart so the watcher reloads the new settings file.
`

const UPDATE_CONFIG_PROMPT = `# Update Config Skill

Modify Leviathan configuration by updating settings.json files.

## When Hooks Are Required

If the user wants something to happen automatically in response to an event, they need a hook configured in settings.json. Memory/preferences cannot trigger automated actions.

Examples that require hooks:
- "Before compacting, ask me what to preserve" -> PreCompact hook
- "After writing files, run prettier" -> PostToolUse hook with Write|Edit matcher
- "When I run bash commands, log them" -> PreToolUse hook with Bash matcher
- "Always run tests after code changes" -> PostToolUse hook

## Workflow

1. Clarify intent if the request is ambiguous.
2. Read the target settings file before changing it.
3. Merge carefully; preserve existing settings, especially arrays.
4. Edit the target file. Create new files only when the user agrees or the requested change clearly needs them.
5. Confirm exactly what changed.

Use the Config tool for simple settings: \`theme\`, \`editorMode\`, \`verbose\`, \`model\`, \`language\`, \`alwaysThinkingEnabled\`, and \`permissions.defaultMode\`.

Edit settings.json directly for hooks, complex permission rules, environment variables, MCP server configuration, and plugin configuration.

${SETTINGS_EXAMPLES_DOCS}

${HOOKS_DOCS}

${HOOK_VERIFICATION_FLOW}

## Example

User: "Format my code after Leviathan writes it"

1. Ask which formatter to use if unclear.
2. Read \`.leviathan/settings.json\`.
3. Merge a PostToolUse hook for Write|Edit.
4. Test the command and confirm the hook path.
`

export function registerUpdateConfigSkill(): void {
  registerBundledSkill({
    name: 'update-config',
    description:
      'Use this skill to configure the Leviathan harness via settings.json. Automated behaviors require hooks configured in settings.json; the harness executes these, not Leviathan memory/preferences. Also use for permissions, env vars, hook troubleshooting, and direct settings.json or settings.local.json changes.',
    allowedTools: ['Read'],
    userInvocable: true,
    async getPromptForCommand(args) {
      if (args.startsWith('[hooks-only]')) {
        const req = args.slice('[hooks-only]'.length).trim()
        let prompt = HOOKS_DOCS + '\n\n' + HOOK_VERIFICATION_FLOW
        if (req) {
          prompt += `\n\n## Task\n\n${req}`
        }
        return [{ type: 'text', text: prompt }]
      }

      const jsonSchema = generateSettingsSchema()

      let prompt = UPDATE_CONFIG_PROMPT
      prompt += `\n\n## Full Settings JSON Schema\n\n\`\`\`json\n${jsonSchema}\n\`\`\``

      if (args) {
        prompt += `\n\n## User Request\n\n${args}`
      }

      return [{ type: 'text', text: prompt }]
    },
  })
}
