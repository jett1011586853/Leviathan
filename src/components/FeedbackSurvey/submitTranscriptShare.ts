import type { Message } from '../../types/message.js'

type TranscriptShareResult = {
  success: boolean
  transcriptId?: string
}

export type TranscriptShareTrigger =
  | 'bad_feedback_survey'
  | 'good_feedback_survey'
  | 'frustration'
  | 'memory_survey'

export async function submitTranscriptShare(
  _messages: Message[],
  _trigger: TranscriptShareTrigger,
  _appearanceId: string,
): Promise<TranscriptShareResult> {
  return { success: false }
}
