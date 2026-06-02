import React, { useCallback, useEffect, useState } from 'react'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import {
  setupTerminal,
  shouldOfferTerminalSetup,
} from '../commands/terminalSetup/terminalSetup.js'
import { useExitOnCtrlCDWithKeybindings } from '../hooks/useExitOnCtrlCDWithKeybindings.js'
import { Box, Newline, Text, useTheme } from '../ink.js'
import { useKeybindings } from '../keybindings/useKeybinding.js'
import type { ThemeSetting } from '../utils/theme.js'
import { env } from '../utils/env.js'
import { Select } from './CustomSelect/select.js'
import { WelcomeV2 } from './LogoV2/WelcomeV2.js'
import { PressEnterToContinue } from './PressEnterToContinue.js'
import { ThemePicker } from './ThemePicker.js'
import { OrderedList } from './ui/OrderedList.js'

type StepId = 'theme' | 'security' | 'terminal-setup'

interface OnboardingStep {
  id: StepId
  component: React.ReactNode
}

type Props = {
  onDone(): void
}

export function Onboarding({ onDone }: Props): React.ReactNode {
  const [currentStepIndex, setCurrentStepIndex] = useState(0)
  const [theme, setTheme] = useTheme()
  const exitState = useExitOnCtrlCDWithKeybindings()

  useEffect(() => {
    logEvent('tengu_began_setup', { oauthEnabled: false })
  }, [])

  function goToNextStep(): void {
    if (currentStepIndex < steps.length - 1) {
      const nextIndex = currentStepIndex + 1
      setCurrentStepIndex(nextIndex)
      logEvent('tengu_onboarding_step', {
        oauthEnabled: false,
        stepId: steps[nextIndex]?.id as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      return
    }
    onDone()
  }

  function handleThemeSelection(newTheme: ThemeSetting): void {
    setTheme(newTheme)
    goToNextStep()
  }

  const steps: OnboardingStep[] = [
    {
      id: 'theme',
      component: (
        <Box marginX={1}>
          <ThemePicker
            onThemeSelect={handleThemeSelection}
            showIntroText={true}
            helpText="To change this later, run /theme"
            hideEscToCancel={true}
            skipExitHandling={true}
          />
        </Box>
      ),
    },
    {
      id: 'security',
      component: (
        <Box flexDirection="column" gap={1} paddingLeft={1}>
          <Text bold>Security notes:</Text>
          <Box flexDirection="column" width={70}>
            <OrderedList>
              <OrderedList.Item>
                <Text>Leviathan can make mistakes</Text>
                <Text dimColor wrap="wrap">
                  Review responses before running generated code.
                  <Newline />
                </Text>
              </OrderedList.Item>
              <OrderedList.Item>
                <Text>Only work in directories and repositories you trust</Text>
                <Text dimColor wrap="wrap">
                  Tool execution can inspect and modify local files.
                </Text>
              </OrderedList.Item>
            </OrderedList>
          </Box>
          <PressEnterToContinue />
        </Box>
      ),
    },
  ]

  if (shouldOfferTerminalSetup()) {
    steps.push({
      id: 'terminal-setup',
      component: (
        <Box flexDirection="column" gap={1} paddingLeft={1}>
          <Text bold>Use Leviathan&apos;s terminal setup?</Text>
          <Box flexDirection="column" width={70} gap={1}>
            <Text>
              Enable recommended terminal settings:{' '}
              {env.terminal === 'Apple_Terminal'
                ? 'Option+Enter for newlines and visual bell'
                : 'Shift+Enter for newlines'}
            </Text>
            <Select
              options={[
                { label: 'Yes, use recommended settings', value: 'install' },
                { label: 'No, maybe later with /terminal-setup', value: 'no' },
              ]}
              onChange={(value: string) => {
                if (value === 'install') {
                  void setupTerminal(theme).catch(() => {}).finally(goToNextStep)
                } else {
                  goToNextStep()
                }
              }}
              onCancel={goToNextStep}
            />
          </Box>
        </Box>
      ),
    })
  }

  const currentStep = steps[currentStepIndex]
  const handleSecurityContinue = useCallback(() => {
    goToNextStep()
  }, [currentStepIndex, steps.length, onDone])
  const handleTerminalSetupSkip = useCallback(() => {
    goToNextStep()
  }, [currentStepIndex, steps.length, onDone])

  useKeybindings(
    { 'confirm:yes': handleSecurityContinue },
    { context: 'Confirmation', isActive: currentStep?.id === 'security' },
  )
  useKeybindings(
    { 'confirm:no': handleTerminalSetupSkip },
    { context: 'Confirmation', isActive: currentStep?.id === 'terminal-setup' },
  )

  return (
    <Box flexDirection="column">
      <WelcomeV2 />
      <Box flexDirection="column" marginTop={1}>
        {currentStep?.component}
        {exitState.pending && (
          <Box padding={1}>
            <Text dimColor>Press {exitState.keyName} again to exit</Text>
          </Box>
        )}
      </Box>
    </Box>
  )
}
