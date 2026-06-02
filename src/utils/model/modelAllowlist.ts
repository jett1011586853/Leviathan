/**
 * Compatibility helper for legacy code paths.
 *
 * Leviathan does not block model IDs locally. Users can point the client at any
 * Anthropic-compatible provider and pass through that provider's model name.
 */
export function isModelAllowed(_model: string): boolean {
  return true
}
