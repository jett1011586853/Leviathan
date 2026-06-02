export function getTungstenToolDescription(): string {
  return `A specialized file editing tool for precise code modifications.

Usage:
- Performs exact string replacements in existing files
- When editing text, ensure you preserve the exact indentation (tabs/spaces)
- The edit will FAIL if old_string is not unique in the file
- Use replace_all to replace all occurrences of old_string`
}
