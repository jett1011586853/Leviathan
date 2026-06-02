import * as React from 'react'
import { Text } from '../ink.js'
import {
  isChromeExtensionInstalled,
  shouldEnableLeviathanBrowser,
} from '../utils/leviathanBrowser/setup.js'
import { isRunningOnHomespace } from '../utils/envUtils.js'
import { useStartupNotification } from './notifs/useStartupNotification.js'

function getChromeFlag(): boolean | undefined {
  if (process.argv.includes('--chrome')) {
    return true
  }
  if (process.argv.includes('--no-chrome')) {
    return false
  }
  return undefined
}

export function useChromeExtensionNotification() {
  useStartupNotification(async () => {
    const chromeFlag = getChromeFlag()
    if (!shouldEnableLeviathanBrowser(chromeFlag)) return null

    const installed = await isChromeExtensionInstalled()
    if (!installed && !isRunningOnHomespace()) {
      return {
        key: 'chrome-extension-not-detected',
        jsx: (
          <Text color="warning">
            Leviathan Browser extension not detected - visit
            https://leviathan.local/chrome to install
          </Text>
        ),
        priority: 'immediate',
        timeoutMs: 3000,
      }
    }

    if (chromeFlag === undefined) {
      return {
        key: 'leviathan-browser-default-enabled',
        text: 'Leviathan Browser integration enabled - /chrome',
        priority: 'low',
      }
    }

    return null
  })
}
