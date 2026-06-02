import type { PermissionMode } from '../../types/permissions.js'

export interface SDKControlRequest {
  type: string
  [key: string]: unknown
}

export interface SDKControlResponse {
  type: string
  ok?: boolean
  error?: string
  [key: string]: unknown
}

export interface StdoutMessage {
  type: string
  text?: string
  [key: string]: unknown
}

export interface SDKControlInitializeRequest {
  type: 'initialize'
  request_id: string
  [key: string]: unknown
}
