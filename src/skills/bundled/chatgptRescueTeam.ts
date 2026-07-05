import { registerBundledSkill } from '../bundledSkills.js'

const CHATGPT_RESCUE_TEAM_PROMPT = `# ChatGPT Rescue Team

Use this skill to form a small rescue workflow when Leviathan is blocked and needs a second opinion from ChatGPT through Browser Use.

Use when the main agent has made a serious attempt but remains uncertain, tests or reasoning are stuck, a problem page needs an outside second opinion, or the user asks to use ChatGPT/GPT as a rescue helper. Do not use for trivial tasks, private secrets, credentials, account recovery, CAPTCHA, or tasks where sending the full page to ChatGPT would violate user privacy.

## Preconditions

- Browser Use must be enabled before using BrowserDevTools.
- If TeamCreate is unavailable, use Agent with a named background helper and the same role instructions.
- Do not send API keys, tokens, passwords, private keys, personal identifiers, unreduced secrets, or unrelated private repository content to ChatGPT.
- If the task is a coding/debugging task, send only the complete problem evidence needed to solve it. Do not send entire files unless the full file is required.

## Team Roles

Main agent:
- Owns the final answer, code change, upload, or submission.
- Decides when the task is blocked enough to ask for rescue.
- Builds the evidence packet and verifies the helper's returned answer.
- Never blindly submits ChatGPT output.

GPT rescue agent:
- Uses BrowserDevTools action ask_chatgpt.
- Sends the complete relevant problem/page information to ChatGPT without summarizing or compressing the problem statement.
- Waits for ChatGPT's answer.
- If ChatGPT is already thinking or generating, do not submit another question. Wait for the existing pending answer.
- Never treat status text such as "thinking", "reasoning", "generating", or "Pro thinking" as an answer.
- Returns the raw answer plus a short extraction of actionable points to the main agent.
- Does not edit code, submit forms, or make final decisions unless explicitly asked by the main agent.

Verifier role:
- Usually handled by the main agent.
- Check ChatGPT's answer against local code, task constraints, tests, screenshots, page text, and user instructions.
- Reject or revise the answer if it conflicts with evidence.

## Trigger Threshold

Use rescue only after at least one of these is true:
- Two independent attempts failed.
- The main agent cannot identify the next useful diagnostic step.
- A test, runtime error, or reasoning branch remains unexplained.
- The problem page contains dense details where missing one sentence could change the answer.
- The user explicitly asks to consult ChatGPT/GPT.

## Evidence Packet Rules

For page/question tasks:
- Capture the full visible problem statement.
- Include all answer choices, instructions, tables, formulas, code blocks, images descriptions, constraints, and hidden/expanded text that is relevant.
- Preserve original wording, order, numbering, punctuation, and units.
- Do not summarize, paraphrase, or compress the question body sent to ChatGPT.
- If the page has images, screenshots, diagrams, or charts that cannot be copied as text, include a faithful textual description and mention that it came from the page image.

For coding/debugging tasks:
- Include exact error messages, failing command, relevant file paths, relevant code snippets, observed behavior, expected behavior, and what has already been tried.
- Include enough context for ChatGPT to reason independently.
- Do not include secrets or unrelated full repository dumps.

Use this packet structure:

\`\`\`text
TASK:
<exact user objective>

FULL PROBLEM/PAGE INFORMATION:
<verbatim full relevant page/problem content, not summarized>

LOCAL CONTEXT:
<commands, errors, file paths, snippets, constraints, attempts>

ASK:
Solve the problem and explain the decisive reasoning. If uncertain, state assumptions and what evidence would disambiguate.
\`\`\`

## Workflow

1. Acknowledge the block internally and decide whether rescue is justified.
2. If agent teams are available, create or reuse a team named chatgpt-rescue.
3. Launch a helper named gpt-rescue with Agent.
4. Give the helper the complete evidence packet and these instructions:

\`\`\`text
You are gpt-rescue. Your only job is to ask ChatGPT for a second opinion through BrowserDevTools action ask_chatgpt.

Send the FULL PROBLEM/PAGE INFORMATION exactly as provided. Do not summarize, compress, reorder, or omit details. Remove only secrets, credentials, private keys, tokens, and unrelated personal/private data.

Wait until ChatGPT returns an answer. Then report back to the main agent with:
1. CHATGPT_RAW_ANSWER: the full answer text returned by ChatGPT.
2. ACTIONABLE_EXTRACT: concise bullets of the usable recommendation.
3. CONFIDENCE_AND_CAVEATS: any uncertainty, assumptions, or parts that need verification.

If ChatGPT is still thinking, keep waiting. Do not submit follow-up prompts to hurry it. Do not edit files, submit answers, click final submit buttons, or claim the answer is verified.
\`\`\`

5. The main agent waits for the helper result or checks team messages.
6. The main agent verifies the response:
   - Compare against page/problem text.
   - Run tests or local checks when applicable.
   - Reconcile contradictions.
   - Prefer local evidence over ChatGPT if they conflict.
7. Only after verification, the main agent applies the fix, writes the answer, or uploads/submits the final result.
8. Record in the final response that ChatGPT was used as an external second opinion, and state what was verified.

## Browser Use Guidance

When the helper calls BrowserDevTools:

\`\`\`json
{
  "action": "ask_chatgpt",
  "question": "<complete evidence packet>",
  "timeout_ms": 120000
}
\`\`\`

If ChatGPT is not logged in or the composer is unavailable, report this to the main agent and ask the user to log in. Do not switch to another website without user approval.

## Stop Conditions

Do not use this workflow when:
- The task can be solved directly with local code/tests/search.
- The evidence packet would include secrets or sensitive private data that cannot be safely redacted.
- The user forbids external services.
- The requested action is credential handling, CAPTCHA bypass, account recovery, or security prompt bypass.
`

export function registerChatGptRescueTeamSkill(): void {
  registerBundledSkill({
    name: 'chatgpt-rescue-team',
    description:
      'Create a rescue agent workflow when Leviathan is blocked: one helper asks ChatGPT through Browser Use with the full relevant problem/page context, returns the answer, and the main agent verifies before applying or submitting.',
    allowedTools: [
      'Agent',
      'TeamCreate',
      'SendMessage',
      'BrowserDevTools',
      'Read',
      'Grep',
      'Glob',
    ],
    argumentHint: '[blocked problem or page context]',
    userInvocable: true,
    async getPromptForCommand(args) {
      let prompt = CHATGPT_RESCUE_TEAM_PROMPT
      if (args.trim()) {
        prompt += `\n## User-provided context\n\n${args.trim()}\n`
      }
      return [{ type: 'text', text: prompt }]
    },
  })
}
