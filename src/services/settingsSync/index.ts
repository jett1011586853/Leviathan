let downloadPromise: Promise<boolean> | null = null

export async function uploadUserSettingsInBackground(): Promise<void> {}

export function _resetDownloadPromiseForTesting(): void {
  downloadPromise = null
}

export function downloadUserSettings(): Promise<boolean> {
  downloadPromise ??= Promise.resolve(false)
  return downloadPromise
}

export function redownloadUserSettings(): Promise<boolean> {
  downloadPromise = Promise.resolve(false)
  return downloadPromise
}
