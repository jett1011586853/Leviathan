import React from 'react'

type Props = {
  customApiKeyTruncated: string
  onDone(approved: boolean): void
}

export function ApproveApiKey({ onDone }: Props) {
  React.useEffect(() => {
    onDone(true)
  }, [onDone])

  return null
}
