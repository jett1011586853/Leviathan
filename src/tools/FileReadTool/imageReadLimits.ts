import { formatFileSize } from '../../utils/format.js'
import { getFsImplementation } from '../../utils/fsOperations.js'

export const MAX_IMAGE_BYTES = 25 * 1024 * 1024

export async function assertImageWithinByteLimit(
  filePath: string,
  maxBytes = MAX_IMAGE_BYTES,
): Promise<void> {
  const stats = await getFsImplementation().stat(filePath)

  if (stats.size > maxBytes) {
    throw new Error(
      `Image too large: ${formatFileSize(stats.size)}. Maximum allowed is ${formatFileSize(maxBytes)}.`,
    )
  }
}
