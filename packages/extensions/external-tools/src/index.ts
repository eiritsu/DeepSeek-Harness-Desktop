/** Credential-gated external tools for DSH. API keys resolve per call. */
import { Context, Service } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-tools'
import { EXTERNAL_TOOL_CATALOG } from './catalog.ts'
import { toolForProvider } from './providers.ts'

export { EXTERNAL_TOOL_CATALOG, externalToolEntry, type ExternalToolCatalogEntry } from './catalog.ts'
export { IMPLEMENTED_EXTERNAL_TOOL_IDS, toolForProvider } from './providers.ts'
export const EXTERNAL_TOOLS_SETTINGS_NAMESPACE = 'external-tools'

export interface Config { disabled?: string[]; endpoints?: Record<string, string> }
export const Config: z<Config> = z.object({ disabled: z.array(z.string()).default([]), endpoints: z.dict(z.string()).default({}) })

declare module '@deepseek-ai/cordis' { interface Context { externalTools: ExternalToolsRegistry } }

export interface ExternalToolStatus {
  readonly id: string
  readonly configured: boolean
  readonly enabled: boolean
  readonly toolRegistered: boolean
}

/** Registry that turns configured provider credentials into model tools. */
export class ExternalToolsRegistry extends Service {
  private readonly disposers = new Map<string, () => void>()
  private readonly configuredIds = new Set<string>()
  private current: () => Config

  constructor(ctx: Context, config: Config) {
    super(ctx, 'externalTools')
    this.current = () => config
    ctx.inject(['settings'], (settingsCtx) => {
      settingsCtx.settings.installSection(ctx, EXTERNAL_TOOLS_SETTINGS_NAMESPACE, Config, config, {
        setSource: (source) => { this.current = source; void this.reconcile() },
        onChange: () => { void this.reconcile() },
      })
    })
    ctx.effect(() => {
      const off = ctx.on('credentials/reference-updated', () => { void this.reconcile() })
      void this.reconcile()
      return off
    }, 'external-tools: credential-gated registration')
    ctx.effect(() => () => {
      for (const dispose of this.disposers.values()) dispose()
      this.disposers.clear()
    }, 'external-tools: tool registrations')
  }

  /** Secret-free provider status for future diagnostics surfaces. */
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
    const credentials = this.ctx.get('credentials')
    if (credentials === undefined) return
    for (const entry of EXTERNAL_TOOL_CATALOG) {
      const configured = (await credentials.resolve(credentialRef(entry.credentialRef))) !== undefined
      if (configured) this.configuredIds.add(entry.id)
      else this.configuredIds.delete(entry.id)
      const enabled = !this.current().disabled?.includes(entry.id)
      const registered = this.disposers.has(entry.id)
      if (configured && enabled && !registered) {
        const endpoint = this.current().endpoints?.[entry.id]
        const definition = toolForProvider(this.ctx, endpoint === undefined ? entry : { ...entry, baseURL: endpoint })
        if (definition !== undefined) this.disposers.set(entry.id, this.ctx.tools.register(definition))
      } else if ((!configured || !enabled) && registered) {
        this.disposers.get(entry.id)?.()
        this.disposers.delete(entry.id)
      }
    }
  }
}

export const name = 'external-tools'
export const inject = ['tools', 'credentials']
export function apply(ctx: Context, config: Config): void { new ExternalToolsRegistry(ctx, config) }
export default ExternalToolsRegistry
