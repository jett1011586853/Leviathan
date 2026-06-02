import type { Workflow } from './types.js'

export async function setupGitHubActions(
  _repoName: string,
  _apiKeyOrOAuthToken: string | null,
  _secretName: string,
  _updateProgress: () => void,
  _skipWorkflow = false,
  _selectedWorkflows: Workflow[],
  _authType: 'api_key' | 'oauth_token',
): Promise<void> {
  throw new Error(
    'Legacy GitHub Actions setup is unavailable until a Leviathan action source is configured.',
  )
}
