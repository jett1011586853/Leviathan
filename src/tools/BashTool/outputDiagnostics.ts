/**
 * Turn cryptic shell failures into actionable guidance for the model.
 *
 * The failures below are the ones that repeatedly derail Windows sessions:
 * a Python script written through a heredoc that stores a Windows path in a
 * normal string literal, a heredoc whose terminator never matched, and a
 * Windows path used inside a WSL shell. In every case the raw interpreter or
 * shell message looks unrelated to the real mistake, so the model retries the
 * same command instead of fixing it.
 */

export function buildCommandFailureHint(stdout: string, stderr: string): string | null {
  const output = `${stdout}\n${stderr}`

  const hints: string[] = []

  const pythonEscapeFailure =
    /\(unicode error\) 'unicodeescape' codec can't decode/.test(output) ||
    /SyntaxError: unterminated string literal/.test(output) ||
    /SyntaxError: invalid \\x escape/.test(output) ||
    /SyntaxError: unexpected character after line continuation character/.test(output)
  if (pythonEscapeFailure) {
    hints.push(
      'The script contains a Windows path inside a normal Python string literal, so Python reads \\U, \\x or \\t as an escape and the literal breaks. Use a raw string (r"C:\\Users\\...") or forward slashes ("C:/Users/...") instead.',
    )
  }

  if (/unexpected EOF while looking for matching/.test(output)) {
    hints.push(
      'The shell command has an unterminated quote. Multi-line file content is safer through the Write tool than through echo/cat heredocs.',
    )
  }

  if (/here-document at line \d+ delimited by end-of-file/.test(output)) {
    hints.push(
      'The heredoc terminator never matched, so the rest of the command was swallowed into the file. Check the terminator line, or write the file with the Write tool.',
    )
  }

  if (
    /No such file or directory/.test(output) &&
    /\b[A-Za-z]:[\\/]/.test(output) &&
    !/\/mnt\//.test(output)
  ) {
    hints.push(
      'A Windows drive path was rejected. Inside a WSL bash use /mnt/c/... paths, or run the command with the PowerShell tool.',
    )
  }

  if (hints.length === 0) return null
  return `<command_hint>\n${hints.join('\n')}\n</command_hint>`
}
