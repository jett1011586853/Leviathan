import { useEffect } from 'react'
import type { AccountSettings } from '../../services/api/grove.js'
import { Text } from '../../ink.js'
import { Dialog } from '../design-system/Dialog.js'

export type GroveDecision =
  | 'accept_opt_in'
  | 'accept_opt_out'
  | 'defer'
  | 'escape'
  | 'skip_rendering'

type Props = {
  showIfAlreadyViewed: boolean
  location: 'settings' | 'policy_update_modal' | 'onboarding'
  onDone(decision: GroveDecision): void
}

export function GroveDialog({ onDone }: Props) {
  useEffect(() => {
    onDone('skip_rendering')
  }, [onDone])

  return null
}

type PrivacySettingsDialogProps = {
  settings: AccountSettings
  domainExcluded?: boolean
  onDone(): void
}

export function PrivacySettingsDialog({
  onDone,
}: PrivacySettingsDialogProps) {
  return (
    <Dialog title="Data Privacy" color="professionalBlue" onCancel={onDone}>
      <Text>
        Leviathan local mode does not use product-account data training
        settings.
      </Text>
    </Dialog>
  )
}
