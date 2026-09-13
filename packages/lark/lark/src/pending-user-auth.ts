/** Persisted current-user device authorization state. */
export interface PendingUserAuthorization {
  /** Opaque device code returned by the official CLI. */
  readonly deviceCode: string
  /** Exact user scopes requested when the device code was created. */
  readonly scopes: readonly string[]
}

/**
 * Serialize a pending authorization for credential storage.
 * @param deviceCode - Opaque code returned by the official CLI.
 * @param scopes - Exact user scopes associated with the code.
 * @returns the credential-safe serialized state.
 */
export function encodePendingUserAuthorization(
  deviceCode: string,
  scopes: readonly string[],
): string {
  if (deviceCode.length === 0) throw new TypeError('device code must not be empty')
  return JSON.stringify({ deviceCode, scopes })
}

/**
 * Decode a pending authorization only when it matches the current scope set.
 * @param value - Serialized credential value.
 * @param currentScopes - Exact scopes required by the current release.
 * @returns validated pending state, or `undefined` when stale or invalid.
 */
export function decodePendingUserAuthorization(
  value: string,
  currentScopes: readonly string[],
): PendingUserAuthorization | undefined {
  try {
    const parsed: unknown = JSON.parse(value)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    const pending = parsed as Record<string, unknown>
    if (typeof pending.deviceCode !== 'string' || pending.deviceCode.length === 0) return undefined
    if (!Array.isArray(pending.scopes) || !pending.scopes.every(scope => typeof scope === 'string')) return undefined
    if (pending.scopes.length !== currentScopes.length
      || !pending.scopes.every((scope, index) => scope === currentScopes[index])) return undefined
    return { deviceCode: pending.deviceCode, scopes: pending.scopes }
  } catch (_invalidPendingAuthorization) {
    return undefined
  }
}
