import { is1mContextDisabled } from '../context.js'

// @[MODEL LAUNCH]: Add check if the new model supports 1M context
export function checkOpus1mAccess(): boolean {
  return !is1mContextDisabled()
}

export function checkSonnet1mAccess(): boolean {
  return !is1mContextDisabled()
}
