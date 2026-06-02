import { LEGACY_ACCOUNT_FEATURE_NOTICE } from '../../leviathan/branding.js'

export type AdminRequestType = 'limit_increase' | 'seat_upgrade'

export type AdminRequestStatus = 'pending' | 'approved' | 'dismissed'

export type AdminRequestSeatUpgradeDetails = {
  message?: string | null
  current_seat_tier?: string | null
}

export type AdminRequestCreateParams =
  | {
      request_type: 'limit_increase'
      details: null
    }
  | {
      request_type: 'seat_upgrade'
      details: AdminRequestSeatUpgradeDetails
    }

export type AdminRequest = {
  uuid: string
  status: AdminRequestStatus
  requester_uuid?: string | null
  created_at: string
} & (
  | {
      request_type: 'limit_increase'
      details: null
    }
  | {
      request_type: 'seat_upgrade'
      details: AdminRequestSeatUpgradeDetails
    }
)

export async function createAdminRequest(
  _params: AdminRequestCreateParams,
): Promise<AdminRequest> {
  throw new Error(LEGACY_ACCOUNT_FEATURE_NOTICE)
}

export async function getMyAdminRequests(
  _requestType: AdminRequestType,
  _statuses: AdminRequestStatus[],
): Promise<AdminRequest[] | null> {
  return null
}

type AdminRequestEligibilityResponse = {
  request_type: AdminRequestType
  is_allowed: boolean
}

export async function checkAdminRequestEligibility(
  requestType: AdminRequestType,
): Promise<AdminRequestEligibilityResponse | null> {
  return { request_type: requestType, is_allowed: false }
}
