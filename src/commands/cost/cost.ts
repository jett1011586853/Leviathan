import { formatTotalCost } from '../../cost-tracker.js'
import type { LocalCommandCall } from '../../types/command.js'

export const call: LocalCommandCall = async () => ({
  type: 'text',
  value: formatTotalCost(),
})
