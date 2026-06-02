import type React from 'react'
import { Text } from '../../ink.js'

export function useShowGuestPassesUpsell(): boolean {
  return false
}

export function incrementGuestPassesSeenCount(): void {}

export function GuestPassesUpsell(): React.ReactNode {
  return <Text dimColor={true}>Leviathan sharing passes are unavailable.</Text>
}
