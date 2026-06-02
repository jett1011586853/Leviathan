import { useEffect, useState } from 'react'
import {
  type ProviderLimits,
  currentLimits,
  statusListeners,
} from './providerLimits.js'

export function useProviderLimits(): ProviderLimits {
  const [limits, setLimits] = useState<ProviderLimits>({ ...currentLimits })

  useEffect(() => {
    const listener = (newLimits: ProviderLimits) => {
      setLimits({ ...newLimits })
    }
    statusListeners.add(listener)

    return () => {
      statusListeners.delete(listener)
    }
  }, [])

  return limits
}
