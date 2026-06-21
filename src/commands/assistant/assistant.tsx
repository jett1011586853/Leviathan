import * as React from 'react'
import { type ReactNode, useEffect } from 'react'
import { Text } from '../../ink.js'

type NewInstallWizardProps = {
  defaultDir: string
  onInstalled: (dir: string) => void
  onCancel: () => void
  onError: (message: string) => void
}

export async function computeDefaultInstallDir(): Promise<string> {
  return ''
}

export function NewInstallWizard({
  onCancel,
}: NewInstallWizardProps): ReactNode {
  useEffect(() => {
    onCancel()
  }, [onCancel])

  return <Text dimColor>Assistant installation is unavailable.</Text>
}
