// In its own file to avoid circular dependencies
export const FILE_EDIT_TOOL_NAME = 'Edit'

// Permission pattern for granting session-level access to the project's .leviathan/ folder
export const LEVIATHAN_FOLDER_PERMISSION_PATTERN = '/.leviathan/**'

// Permission pattern for granting session-level access to the global ~/.leviathan/ folder
export const GLOBAL_LEVIATHAN_FOLDER_PERMISSION_PATTERN = '~/.leviathan/**'

export const FILE_UNEXPECTEDLY_MODIFIED_ERROR =
  'File has been unexpectedly modified. Read it again before attempting to write it.'
