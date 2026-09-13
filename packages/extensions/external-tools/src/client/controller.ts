/** Browser controller for the external-tools settings tab. */
import type { Context } from '@deepseek-ai/cordis'
import type { CredentialInfo } from '@deepseek-ai/dsh-api-remotes/client'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import { DEFAULT_SEARCH_PRIORITY, EXTERNAL_TOOL_CATALOG, isNativeSearchProvider, type ExternalToolCatalogEntry } from '../catalog.ts'

/** One provider row projected to the settings tab. */
export interface ExternalToolRow {
  readonly entry: ExternalToolCatalogEntry
  readonly configured: boolean
  readonly writable: boolean
  readonly enabled: boolean
  readonly endpoint: string
}
/** Current loading, credential, enablement, and search-priority state. */
export interface ExternalToolsSnapshot {
  readonly loading: boolean
  readonly rows: readonly ExternalToolRow[]
  readonly searchPriority: readonly string[]
  readonly error?: string
}
/** Browser-facing controller operations for the external-tools settings tab. */
export interface ExternalToolsFace {
  readonly useExternalTools: <T>(selector: (value: ExternalToolsSnapshot) => T) => T
  readonly subscribe: (listener: () => void) => () => void
  readonly refresh: () => Promise<void>
  readonly toggle: (id: string) => Promise<void>
  readonly setKey: (id: string, value: string) => Promise<void>
  readonly clearKey: (id: string) => Promise<void>
  readonly setEndpoint: (id: string, value: string) => Promise<void>
  readonly setSearchPriority: (order: readonly string[]) => Promise<void>
}

/** Coordinates credential and settings RPCs for the external-tools tab. */
export class ExternalToolsController {
  private snapshot: ExternalToolsSnapshot = {
    loading: true,
    searchPriority: DEFAULT_SEARCH_PRIORITY,
    rows: EXTERNAL_TOOL_CATALOG.map(entry => ({
      entry,
      configured: false,
      writable: false,
      enabled: true,
      endpoint: entry.baseURL ?? '',
    })),
  }
  private readonly listeners = new Set<() => void>()
  private generation = 0
  constructor(private readonly ctx: Context, private readonly scope: SettingsScope<Record<string, unknown>>) {}
  /** Return the latest immutable tab snapshot.
   * @returns the latest immutable tab snapshot.
   */
  getSnapshot = (): ExternalToolsSnapshot => this.snapshot
  /**
   * Subscribe to snapshot changes.
   * @param listener - callback invoked after a refresh.
   * @returns disposer for the subscription.
   */
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  /** Refresh credential and settings state from the host. */
  async refresh(): Promise<void> {
    const generation = ++this.generation
    try {
      const refs = EXTERNAL_TOOL_CATALOG.map(entry => entry.credentialRef)
      const response = await withTimeout(this.ctx.remote.credentials.describe(refs), 15000)
      if (generation !== this.generation) return
      if (!response.ok) {
        this.snapshot = { loading: false, rows: [], searchPriority: DEFAULT_SEARCH_PRIORITY, error: response.error.message }
        this.notify()
        return
      }
      const info: Record<string, CredentialInfo> = response.value
      const raw = this.scope.getSnapshot().value
      const disabled = Array.isArray(raw?.disabled) ? raw.disabled.filter((id): id is string => typeof id === 'string') : []
      const endpoints = raw?.endpoints && typeof raw.endpoints === 'object' ? raw.endpoints as Record<string, unknown> : {}
      const configuredPriority = Array.isArray(raw?.searchPriority) ? raw.searchPriority.filter((id): id is string => typeof id === 'string') : []
      const searchPriority = [...new Set([...configuredPriority, ...DEFAULT_SEARCH_PRIORITY])]
      this.snapshot = { loading: false, searchPriority, rows: EXTERNAL_TOOL_CATALOG.map((entry) => { const override = endpoints[entry.id]; return { entry, configured: info[entry.credentialRef]?.configured === true, writable: info[entry.credentialRef]?.writable === true, enabled: !disabled.includes(entry.id), endpoint: typeof override === 'string' ? override : entry.baseURL ?? '' } }) }
      for (const listener of this.listeners) listener()
    } catch (error) {
      if (generation !== this.generation) return
      this.snapshot = {
        loading: false,
        rows: [],
        searchPriority: DEFAULT_SEARCH_PRIORITY,
        error: error instanceof Error ? error.message : String(error),
      }
      this.notify()
    }
  }
  /**
   * Toggle one provider's enabled state.
   * @param id - catalog provider id.
   */
  async toggle(id: string): Promise<void> {
    const raw = this.scope.getSnapshot().value
    const disabled = Array.isArray(raw?.disabled) ? raw.disabled.filter((item): item is string => typeof item === 'string') : []
    await this.scope.set('disabled', disabled.includes(id) ? disabled.filter(item => item !== id) : [...disabled, id])
    await this.refresh()
  }
  /**
   * Store one provider key through the credential service.
   * @param id - catalog provider id.
   * @param value - secret value supplied by the user.
   */
  async setKey(id: string, value: string): Promise<void> {
    const entry = EXTERNAL_TOOL_CATALOG.find(item => item.id === id)
    if (entry === undefined) return
    await this.ctx.remote.credentials.set(entry.credentialRef, value)
    await this.refresh()
  }
  /**
   * Remove one provider key through the credential service.
   * @param id - catalog provider id.
   */
  async clearKey(id: string): Promise<void> {
    const entry = EXTERNAL_TOOL_CATALOG.find(item => item.id === id)
    if (entry === undefined) return
    await this.ctx.remote.credentials.unset(entry.credentialRef)
    await this.refresh()
  }
  /**
   * Persist one provider endpoint override.
   * @param id - catalog provider id.
   * @param value - endpoint URL or empty string to clear the override.
   */
  async setEndpoint(id: string, value: string): Promise<void> {
    const entry = EXTERNAL_TOOL_CATALOG.find(item => item.id === id)
    if (entry === undefined) return
    const raw = this.scope.getSnapshot().value
    const previous = raw?.endpoints && typeof raw.endpoints === 'object' ? raw.endpoints as Record<string, unknown> : {}
    const trimmed = value.trim()
    const endpoints = trimmed === '' || trimmed === (entry.baseURL ?? '')
      ? Object.fromEntries(Object.entries(previous).filter(([key]) => key !== id))
      : { ...previous, [id]: trimmed }
    await this.scope.set('endpoints', endpoints)
    await this.refresh()
  }
  /**
   * Persist the ordered native search provider ids.
   * @param order - provider ids in descending priority.
   */
  async setSearchPriority(order: readonly string[]): Promise<void> {
    const known = new Set(EXTERNAL_TOOL_CATALOG.filter(entry => entry.capabilities.includes('search') && isNativeSearchProvider(entry.id)).map(entry => entry.id))
    const normalized = [...new Set(order.filter(id => known.has(id)))]
    await this.scope.set('searchPriority', normalized)
    await this.refresh()
  }
  private notify(): void { for (const listener of this.listeners) listener() }
  /**
   * Return the controller face consumed by the settings slot.
   * @returns browser controller operations.
   */
  inject(): ExternalToolsFace {
    return {
      useExternalTools: selector => selector(this.snapshot), subscribe: this.subscribe,
      refresh: () => this.refresh(), toggle: id => this.toggle(id), setKey: (id, value) => this.setKey(id, value),
      clearKey: id => this.clearKey(id), setEndpoint: (id, value) => this.setEndpoint(id, value),
      setSearchPriority: order => this.setSearchPriority(order),
    }
  }
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => { reject(new Error('external-tools: credential request timed out')) }, milliseconds)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
