/** Browser-safe request and response vocabulary for Lark management Remote calls. */

import type { LarkCapabilityId } from './permissions.ts'

/** Application values accepted from the management page. */
export interface LarkApplicationInput {
  /** Self-built application id. */
  readonly appId: string
  /** Product endpoint family. */
  readonly brand: 'feishu' | 'lark'
  /** Optional replacement secret; omission preserves the current secret. */
  readonly appSecret?: string
}

/** One identity reported by the official CLI. */
export interface LarkIdentityStatus {
  /** CLI identity state. */
  readonly status: string
  /** Whether the identity can currently be used. */
  readonly available: boolean
  /** Server verification result, when verification ran. */
  readonly verified?: boolean
}

/** Runtime state of the private-chat transport. */
export interface LarkConversationStatus {
  /** Current connection phase. */
  readonly status: 'disabled' | 'waiting' | 'connecting' | 'ready' | 'error'
  /** Non-secret explanation when the transport is not ready. */
  readonly diagnostic?: string
}

/** Permission outcome for one management-page capability row. */
export interface LarkCapabilityStatus {
  /** Stable capability id. */
  readonly id: LarkCapabilityId
  /** Chinese label supplied by the capability catalog. */
  readonly label: string
  /** Whether every required tenant and user scope is enabled for the application. */
  readonly state: 'granted' | 'missing' | 'unknown'
  /** Required scopes not reported by the application. */
  readonly missingScopes: readonly string[]
}

/** Complete safe-to-display Lark management snapshot. */
export interface LarkManagementStatus {
  readonly appId: string
  readonly brand: 'feishu' | 'lark'
  readonly credentialMode: 'none' | 'managed' | 'self-built'
  readonly secretConfigured: boolean
  readonly secretWritable: boolean
  readonly userAuthorizationPending: boolean
  readonly cliAvailable: boolean
  readonly bot: LarkIdentityStatus
  readonly user: LarkIdentityStatus
  readonly userAuthorizationMissingScopes: readonly string[]
  readonly conversation: LarkConversationStatus
  readonly capabilities: readonly LarkCapabilityStatus[]
  /** Batch-import JSON copied by the page without rendering it. */
  readonly permissionTemplate: string
  /** Non-secret diagnostic from the latest inspection failure. */
  readonly diagnostic?: string
}

/** Browser handoff for current-user device authorization. */
export interface LarkUserAuthRequest {
  readonly verificationUrl: string
}

/** Browser handoff for official managed PersonalAgent registration. */
export interface LarkManagedRegistrationRequest {
  readonly verificationUrl: string
}
