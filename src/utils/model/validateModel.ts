/**
 * Compatibility helper for legacy call sites.
 *
 * Leviathan accepts arbitrary model IDs from Anthropic-compatible providers.
 * Do not make a probing API call here: custom gateways may use private model
 * names, route aliases, or deployment IDs that are valid only at generation time.
 */
export async function validateModel(
  model: string,
): Promise<{ valid: boolean; error?: string }> {
  if (!model.trim()) {
    return { valid: false, error: 'Model name cannot be empty' }
  }

  return { valid: true }
}
