export const UNRESOLVED_MERGE_CONFLICT_ERROR =
  'Cannot write unresolved merge conflict markers.'

const CONFLICT_MARKER_BLOCK =
  /^<<<<<<<[^\r\n]*(?:\r?\n)[\s\S]*?^=======$(?:\r?\n)[\s\S]*?^>>>>>>>[^\r\n]*(?=\r?\n|$)/m

export function containsUnresolvedMergeConflictMarkers(content: string): boolean {
  return CONFLICT_MARKER_BLOCK.test(content)
}

export function assertNoUnresolvedMergeConflictMarkers(content: string): void {
  if (containsUnresolvedMergeConflictMarkers(content)) {
    throw new Error(UNRESOLVED_MERGE_CONFLICT_ERROR)
  }
}
