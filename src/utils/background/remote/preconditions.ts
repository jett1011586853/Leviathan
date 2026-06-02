import { getCwd } from '../../cwd.js'
import { detectCurrentRepository } from '../../detectRepository.js'
import { findGitRoot, getIsClean } from '../../git.js'

export async function checkNeedsLeviathanRemoteLogin(): Promise<boolean> {
  return false
}

export async function checkIsGitClean(): Promise<boolean> {
  return getIsClean({ ignoreUntracked: true })
}

export async function checkHasRemoteEnvironment(): Promise<boolean> {
  return false
}

export function checkIsInGitRepo(): boolean {
  return findGitRoot(getCwd()) !== null
}

export async function checkHasGitRemote(): Promise<boolean> {
  return (await detectCurrentRepository()) !== null
}

export async function checkGithubAppInstalled(
  _owner: string,
  _repo: string,
  _signal?: AbortSignal,
): Promise<boolean> {
  return false
}

export async function checkGithubTokenSynced(): Promise<boolean> {
  return false
}

type RepoAccessMethod = 'github-app' | 'token-sync' | 'none'

export async function checkRepoForRemoteAccess(
  _owner: string,
  _repo: string,
): Promise<{ hasAccess: boolean; method: RepoAccessMethod }> {
  return { hasAccess: false, method: 'none' }
}
