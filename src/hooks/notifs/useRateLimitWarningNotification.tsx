import * as React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { getIsRemoteMode } from '../../bootstrap/state.js'
import { useNotifications } from '../../context/notifications.js'
import { Text } from '../../ink.js'
import {
  getRateLimitWarning,
  getUsingOverageText,
} from '../../services/rateLimitMessages.js'
import { useProviderLimits } from '../../services/providerLimitsHook.js'

export function useRateLimitWarningNotification(model: string): void {
  const { addNotification } = useNotifications()
  const providerLimits = useProviderLimits()
  const rateLimitWarning = useMemo(
    () => getRateLimitWarning(providerLimits, model),
    [providerLimits, model],
  )
  const usingOverageText = useMemo(
    () => getUsingOverageText(providerLimits),
    [providerLimits],
  )
  const shownWarningRef = useRef<string | null>(null)
  const [hasShownOverageNotification, setHasShownOverageNotification] =
    useState(false)

  useEffect(() => {
    if (getIsRemoteMode()) return
    if (providerLimits.isUsingOverage && !hasShownOverageNotification) {
      addNotification({
        key: 'limit-reached',
        text: usingOverageText,
        priority: 'immediate',
      })
      setHasShownOverageNotification(true)
    } else if (!providerLimits.isUsingOverage && hasShownOverageNotification) {
      setHasShownOverageNotification(false)
    }
  }, [
    providerLimits.isUsingOverage,
    usingOverageText,
    hasShownOverageNotification,
    addNotification,
  ])

  useEffect(() => {
    if (getIsRemoteMode()) return
    if (rateLimitWarning && rateLimitWarning !== shownWarningRef.current) {
      shownWarningRef.current = rateLimitWarning
      addNotification({
        key: 'rate-limit-warning',
        jsx: (
          <Text>
            <Text color="warning">{rateLimitWarning}</Text>
          </Text>
        ),
        priority: 'high',
      })
    }
  }, [rateLimitWarning, addNotification])
}
