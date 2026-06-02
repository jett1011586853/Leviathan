export const BASE_CHROME_PROMPT = `# Leviathan browser automation

Leviathan browser automation is unavailable until a Leviathan browser extension source is configured. Use configured browser automation tools such as WebBrowser or Playwright when they are available in the current session.`

export const CHROME_TOOL_SEARCH_INSTRUCTIONS = `**Browser Automation**: Load and use only the browser automation tools that are actually available in this session. Prefer WebBrowser or Playwright for development tasks.`

export function getChromeSystemPrompt(): string {
  return BASE_CHROME_PROMPT
}

export const LEVIATHAN_BROWSER_SKILL_HINT = `**Browser Automation**: Leviathan browser extension tools are unavailable in this local build. Use configured browser automation tools such as WebBrowser or Playwright when available.`

export const LEVIATHAN_BROWSER_SKILL_HINT_WITH_WEBBROWSER = `**Browser Automation**: Use WebBrowser for development tasks such as dev servers, JavaScript evaluation, console inspection, and screenshots.`
