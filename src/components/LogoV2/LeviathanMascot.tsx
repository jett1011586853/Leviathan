import React from 'react'
import { LeviathanWhale } from './LeviathanWhale.js'

export type LeviathanMascotPose =
  | 'default'
  | 'arms-up'
  | 'look-left'
  | 'look-right'

type Props = {
  pose?: LeviathanMascotPose
}

export function LeviathanMascot(_props: Props): React.ReactNode {
  return <LeviathanWhale />
}

export function LeviathanMascotImpl(props: Props): React.ReactNode {
  return <LeviathanMascot {...props} />
}

export default LeviathanMascot
