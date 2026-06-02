import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { Box } from '../../ink.js'
import { getInitialSettings } from '../../utils/settings/settings.js'
import {
  LeviathanMascot,
  type LeviathanMascotPose,
} from './LeviathanMascot.js'

type Frame = {
  pose: LeviathanMascotPose
  offset: number
}

function hold(
  pose: LeviathanMascotPose,
  offset: number,
  frames: number,
): Frame[] {
  return Array.from({ length: frames }, () => ({ pose, offset }))
}

const JUMP_WAVE: readonly Frame[] = [
  ...hold('default', 1, 2),
  ...hold('arms-up', 0, 3),
  ...hold('default', 0, 1),
  ...hold('default', 1, 2),
  ...hold('arms-up', 0, 3),
  ...hold('default', 0, 1),
]

const LOOK_AROUND: readonly Frame[] = [
  ...hold('look-right', 0, 5),
  ...hold('look-left', 0, 5),
  ...hold('default', 0, 1),
]

const CLICK_ANIMATIONS: readonly (readonly Frame[])[] = [
  JUMP_WAVE,
  LOOK_AROUND,
]
const IDLE: Frame = { pose: 'default', offset: 0 }
const FRAME_MS = 60
const MASCOT_HEIGHT = 5
const incrementFrame = (i: number) => i + 1

export function AnimatedLeviathanMascot(): React.ReactNode {
  const { pose, bounceOffset, onClick } = useLeviathanMascotAnimation()

  return (
    <Box height={MASCOT_HEIGHT} flexDirection="column" onClick={onClick}>
      <Box marginTop={bounceOffset} flexShrink={0}>
        <LeviathanMascot pose={pose} />
      </Box>
    </Box>
  )
}

function useLeviathanMascotAnimation(): {
  pose: LeviathanMascotPose
  bounceOffset: number
  onClick: () => void
} {
  const [reducedMotion] = useState(
    () => getInitialSettings().prefersReducedMotion ?? false,
  )
  const [frameIndex, setFrameIndex] = useState(-1)
  const sequenceRef = useRef<readonly Frame[]>(JUMP_WAVE)

  const onClick = () => {
    if (reducedMotion || frameIndex !== -1) return
    sequenceRef.current =
      CLICK_ANIMATIONS[
        Math.floor(Math.random() * CLICK_ANIMATIONS.length)
      ]!
    setFrameIndex(0)
  }

  useEffect(() => {
    if (frameIndex === -1) return
    if (frameIndex >= sequenceRef.current.length) {
      setFrameIndex(-1)
      return
    }
    const timer = setTimeout(setFrameIndex, FRAME_MS, incrementFrame)
    return () => clearTimeout(timer)
  }, [frameIndex])

  const seq = sequenceRef.current
  const current =
    frameIndex >= 0 && frameIndex < seq.length ? seq[frameIndex]! : IDLE

  return {
    pose: current.pose,
    bounceOffset: current.offset,
    onClick,
  }
}
