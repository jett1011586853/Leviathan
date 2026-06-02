import { registerBundledSkill } from '../bundledSkills.js'

// Prompt text contains `ps` commands as instructions for Leviathan to run,
// not commands this file executes.
// eslint-disable-next-line custom-rules/no-direct-ps-commands
const STUCK_PROMPT = `# /stuck - diagnose frozen or slow Leviathan sessions

The user thinks another Leviathan session on this machine is frozen, stuck, or very slow. Investigate locally and return a diagnostic report to the user. Do not post to external channels.

## What to look for

Scan for other Leviathan processes, excluding the current one. Process names may be \`leviathan\`, \`claude\` from a legacy install, or \`cli\` in a native development build.

Signs of a stuck session:
- High CPU sustained across two samples taken 1-2 seconds apart
- Process state \`D\` for uninterruptible sleep, often an I/O hang
- Process state \`T\`, often from Ctrl+Z
- Process state \`Z\`, a zombie process
- Very high RSS, suggesting memory pressure
- A stuck child process such as \`git\`, \`node\`, or a shell command

## Investigation steps

1. List candidate processes:
   \`\`\`
   ps -axo pid=,pcpu=,rss=,etime=,state=,comm=,command= | grep -E '(leviathan|claude|cli)' | grep -v grep
   \`\`\`
2. For suspicious processes, gather child process details with \`pgrep -lP <pid>\`.
3. If CPU is high, sample again after 1-2 seconds to confirm it is sustained.
4. If a child process looks hung, capture its command line with \`ps -p <child_pid> -o command=\`.
5. Check the session debug log if you can infer the session ID. In Leviathan builds, prefer the configured Leviathan debug location; legacy debug logs may still exist during migration.

## Report

Only report what you actually found. If every session looks healthy, say that directly.

Use a concise structure:
1. Summary: hostname, suspected PID, and terse symptom.
2. Details: CPU, RSS, state, uptime, command line, child processes, and likely cause.
3. Suggested next action, without killing or signaling any process unless the user explicitly asks.

If the user gave an argument such as a PID or symptom, focus there first.
`

export function registerStuckSkill(): void {
  if (process.env.USER_TYPE !== 'ant') {
    return
  }

  registerBundledSkill({
    name: 'stuck',
    description:
      '[DEV] Investigate frozen, stuck, or slow Leviathan sessions on this machine and return a local diagnostic report.',
    userInvocable: true,
    async getPromptForCommand(args) {
      let prompt = STUCK_PROMPT
      if (args) {
        prompt += `\n## User-provided context\n\n${args}\n`
      }
      return [{ type: 'text', text: prompt }]
    },
  })
}
