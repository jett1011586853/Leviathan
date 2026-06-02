import React, { useCallback, useEffect, useState } from 'react'
import {
  checkIsGitClean,
  checkNeedsLeviathanRemoteLogin,
} from 'src/utils/background/remote/preconditions.js'
import { gracefulShutdownSync } from 'src/utils/gracefulShutdown.js'
import { Box, Text } from '../ink.js'
import { LEGACY_ACCOUNT_FEATURE_NOTICE } from '../leviathan/branding.js'
import { Select } from './CustomSelect/index.js'
import { Dialog } from './design-system/Dialog.js'
import { TeleportStash } from './TeleportStash.js'

export type TeleportLocalErrorType = 'needsLogin' | 'needsGitStash'

type TeleportErrorProps = {
  onComplete: () => void
  errorsToIgnore?: ReadonlySet<TeleportLocalErrorType>
}

const EMPTY_ERRORS_TO_IGNORE: ReadonlySet<TeleportLocalErrorType> = new Set()

export function TeleportError({
  onComplete,
  errorsToIgnore = EMPTY_ERRORS_TO_IGNORE,
}: TeleportErrorProps): React.ReactNode {
  const [currentError, setCurrentError] = useState<TeleportLocalErrorType | null>(
    null,
  )
  const checkErrors = useCallback(async () => {
    const currentErrors = await getTeleportErrors()
    const filteredErrors = new Set(
      Array.from(currentErrors).filter(error => !errorsToIgnore.has(error)),
    )
    if (filteredErrors.size === 0) {
      onComplete()
    } else if (filteredErrors.has('needsLogin')) {
      setCurrentError('needsLogin')
    } else if (filteredErrors.has('needsGitStash')) {
      setCurrentError('needsGitStash')
    }
  }, [errorsToIgnore, onComplete])

  useEffect(() => {
    void checkErrors()
  }, [checkErrors])

  const onCancel = useCallback(() => gracefulShutdownSync(0), [])

  if (currentError === 'needsGitStash') {
    return (
      <TeleportStash onStashAndContinue={checkErrors} onCancel={onCancel} />
    )
  }
  if (currentError === 'needsLogin') {
    return (
      <Dialog title="Remote session unavailable" onCancel={onCancel}>
        <Box flexDirection="column" gap={1}>
          <Text dimColor>{LEGACY_ACCOUNT_FEATURE_NOTICE}</Text>
          <Select
            options={[{ label: 'Exit', value: 'exit' }]}
            onChange={onCancel}
          />
        </Box>
      </Dialog>
    )
  }
  return null
}

export async function getTeleportErrors(): Promise<
  Set<TeleportLocalErrorType>
> {
  const errors = new Set<TeleportLocalErrorType>()
  const [needsLogin, isGitClean] = await Promise.all([
    checkNeedsLeviathanRemoteLogin(),
    checkIsGitClean(),
  ])
  if (needsLogin) {
    errors.add('needsLogin')
  }
  if (!isGitClean) {
    errors.add('needsGitStash')
  }
  return errors
}
