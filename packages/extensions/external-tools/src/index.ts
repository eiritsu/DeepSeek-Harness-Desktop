/** Credential-gated external tools for DSH. API keys resolve per call. */
import { Context, Service } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-tools'
import { DEFAULT_SEARCH_PRIORITY, EXTERNAL_TOOL_CATALOG, isNativeSearchProvider } from './catalog.ts'
import { toolForProvider, webProviderForProvider } from './providers.ts'

export { DEFAULT_SEARCH_PRIORITY, EXTERNAL_TOOL_CATALOG, externalToolEntry, isNativeSearchProvider, type ExternalToolCatalogEntry } from './catalog.ts'
export { IMPLEMENTED_EXTERNAL_TOOL_IDS, ExternalSearchProvider, TavilySearchProvider, mapBraveResponse, mapExaResponse, mapTavilyResponse, toolForProvider, webProviderForProvider } from './providers.ts'
export type { TavilySearchProviderOptions } from './providers.ts'
/** Settings namespace owned by the external-tools registry. */
export const EXTERNAL_TOOLS_SETTINGS_NAMESPACE = 'external-tools'

/** Host configuration for credential-gated provider registration. */
export interface Config {
  /** Provider ids that remain configured but do not register model tools. */
  disabled?: string[]
  /** Provider-specific endpoint overrides, keyed by catalog id. */
  endpoints?: Record<string, string>
  /** Ordered search provider ids used by the native `web_search` adapter. */
  searchPriority?: string[]
}
export const Config: z<Config> = z.object({
  disabled: z.array(z.string()).default([]),
  endpoints: z.dict(z.string()).default({}),
  searchPriority: z.array(z.string()).default([...DEFAULT_SEARCH_PRIORITY]),
})

declare module '@deepseek-ai/cordis' { interface Context { externalTools: ExternalToolsRegistry } }

/** Secret-free provider status exposed for diagnostics and UI projections. */
export interface ExternalToolStatus {
  readonly id: string
  readonly configured: boolean
  readonly enabled: boolean
  readonly toolRegistered: boolean
}

/** Registry that turns configured provider credentials into model tools. */
export class ExternalToolsRegistry extends Service {
  private readonly disposers = new Map<string, () => void>()
  private readonly webDisposers = new Map<string, () => void>()
  private readonly webEndpoints = new Map<string, string>()
  private readonly configuredIds = new Set<string>()
  private current: () => Config
  private reconcileChain: Promise<void> = Promise.resolve()
  private closed = false

  constructor(ctx: Context, config: Config) {
    super(ctx, 'externalTools')
    this.current = () => config
    ctx.inject(['settings'], (settingsCtx) => {
      settingsCtx.settings.installSection(ctx, EXTERNAL_TOOLS_SETTINGS_NAMESPACE, Config, config, {
        setSource: (source) => { this.current = source; this.scheduleReconcile() },
        onChange: () => { this.scheduleReconcile() },
      })
    })
    ctx.effect(() => {
      const off = ctx.on('credentials/reference-updated', () => { this.scheduleReconcile() })
      this.scheduleReconcile()
      return off
    }, 'external-tools: credential-gated registration')
    ctx.effect(() => () => {
      this.closed = true
      for (const dispose of this.disposers.values()) dispose()
      this.disposers.clear()
      for (const dispose of this.webDisposers.values()) dispose()
      this.webDisposers.clear()
      this.webEndpoints.clear()
      this.ctx.web.setSearchProviderOverride(undefined)
    }, 'external-tools: tool registrations')
  }

  private scheduleReconcile(): void {
    if (this.closed) return
    this.reconcileChain = this.reconcileChain.then(() => this.reconcile(), () => this.reconcile())
    void this.reconcileChain.catch(error => this.ctx.logger.error(error))
  }

  /** Secret-free provider status for future diagnostics surfaces.
   * @returns One status record for each catalog entry.
   */
  status(): ExternalToolStatus[] {
    const current = this.current()
    return EXTERNAL_TOOL_CATALOG.map(entry => ({
      id: entry.id,
      configured: this.configuredIds.has(entry.id),
      enabled: !current.disabled?.includes(entry.id),
      toolRegistered: this.disposers.has(entry.id),
    }))
  }

  private async reconcile(): Promise<void> {
    if (this.closed) return
    const credentials = this.ctx.get('credentials', false)
    if (credentials === undefined) return
    for (const entry of EXTERNAL_TOOL_CATALOG) {
      const configured = (await credentials.resolve(credentialRef(entry.credentialRef))) !== undefined
      if (this.closed) return
      if (configured) this.configuredIds.add(entry.id)
      else this.configuredIds.delete(entry.id)
      const enabled = !this.current().disabled?.includes(entry.id)
      const registered = this.disposers.has(entry.id)
      if (configured && enabled) {
        const endpoint = this.current().endpoints?.[entry.id]
        const resolvedEntry = endpoint === undefined ? entry : { ...entry, baseURL: endpoint }
        if (!registered) {
          const definition = toolForProvider(this.ctx, resolvedEntry)
          if (definition !== undefined) this.disposers.set(entry.id, this.ctx.tools.register(definition))
        }
      } else if ((!configured || !enabled) && registered) {
        this.disposers.get(entry.id)?.()
        this.disposers.delete(entry.id)
      }
    }
    const priority = this.current().searchPriority ?? [...DEFAULT_SEARCH_PRIORITY]
    const priorityRank = new Map(priority.map((id, index) => [id, index]))
    const candidates = EXTERNAL_TOOL_CATALOG
      .filter(entry => entry.capabilities.includes('search')
        && isNativeSearchProvider(entry.id)
        && this.configuredIds.has(entry.id)
        && !this.current().disabled?.includes(entry.id)
        && entry.baseURL !== undefined)
      .sort((left, right) => {
        const leftRank = priorityRank.get(left.id) ?? priority.length + EXTERNAL_TOOL_CATALOG.indexOf(left)
        const rightRank = priorityRank.get(right.id) ?? priority.length + EXTERNAL_TOOL_CATALOG.indexOf(right)
        return leftRank - rightRank
      })
    const selected = candidates[0]
    this.ctx.web.setSearchProviderOverride(selected?.id)
    for (const [id, dispose] of this.webDisposers) {
      if (selected?.id === id) continue
      dispose()
      this.webDisposers.delete(id)
      this.webEndpoints.delete(id)
    }
    if (selected !== undefined && !this.webDisposers.has(selected.id)) {
      const endpoint = this.current().endpoints?.[selected.id]
      const resolvedEntry = endpoint === undefined ? selected : { ...selected, baseURL: endpoint }
      const provider = webProviderForProvider(this.ctx, resolvedEntry, () => this.configuredIds.has(selected.id))
      if (provider !== undefined) {
        this.webDisposers.set(selected.id, this.ctx.web.registerSearchProvider(provider))
        this.webEndpoints.set(selected.id, resolvedEntry.baseURL ?? '')
      }
    } else if (selected !== undefined) {
      const endpoint = this.current().endpoints?.[selected.id] ?? selected.baseURL ?? ''
      if (this.webEndpoints.get(selected.id) !== endpoint) {
        this.webDisposers.get(selected.id)?.()
        this.webDisposers.delete(selected.id)
        this.webEndpoints.delete(selected.id)
        const resolvedEntry = this.current().endpoints?.[selected.id] === undefined ? selected : { ...selected, baseURL: endpoint }
        const provider = webProviderForProvider(this.ctx, resolvedEntry, () => this.configuredIds.has(selected.id))
        if (provider !== undefined) {
          this.webDisposers.set(selected.id, this.ctx.web.registerSearchProvider(provider))
          this.webEndpoints.set(selected.id, resolvedEntry.baseURL ?? '')
        }
      }
    }
  }
}

export const name = 'external-tools'
export const inject = ['tools', 'credentials', 'web']
export function apply(ctx: Context, config: Config): void { new ExternalToolsRegistry(ctx, config) }
