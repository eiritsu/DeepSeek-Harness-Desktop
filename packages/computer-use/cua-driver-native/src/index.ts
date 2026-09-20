/**
 * Computer use through the in-process Cua Driver native SDK and its own tools.
 * @module @deepseek-ai/dsh-computer-use-cua-driver-native
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { ComputerUseProviderName } from '@deepseek-ai/dsh-computer-use/brand'
import { createMcpToolDefinition } from '@deepseek-ai/dsh-mcp-client'
import { z } from 'zod'
import type { CuaDriver as NativeDriver } from '@trycua/cua-driver'
import type {} from '@deepseek-ai/dsh-computer-use'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { DEFAULT_ENABLED, ENABLED_FIELD, SETTINGS_NAMESPACE, type RuntimeSettings } from './settings.ts'

export {
  DEFAULT_ENABLED, ENABLED_FIELD, SETTINGS_NAMESPACE, type RuntimeSettings,
} from './settings.ts'

/** Cordis plugin identity for the native Cua Driver provider. */
export const name = 'computer-use-cua-driver-native'

/** Services required before the native runtime can publish tools. */
export const inject = ['computerUse', 'tools', 'systemPrompt']

/** Native provider configuration; the durable settings document can override the mount state. */
export interface Config {
  /** Whether the native runtime mounts at composition. */
  enabled: boolean
}

/** The native provider mounts unless the composition or the user disables it. */
export const Config = Schema.object({
  enabled: Schema.boolean().default(DEFAULT_ENABLED),
})

const ToolCatalog = z.object({
  tools: z.array(z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    inputSchema: z.record(z.string(), z.unknown()),
    outputSchema: z.unknown().optional(),
  })),
})

/** DeepSeek's function-name alphabet and maximum length are protocol constants. */
const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/u

const GUIDANCE = `Cua Driver native computer-use tools operate the host desktop. Discover the exact app and window, then get a fresh window snapshot before acting. Use element_token from that snapshot, or coordinates from its screenshot. A new snapshot of that window invalidates its earlier element tokens. Select either target or the legacy pid/window_id fields; do not combine them.

Prefer background delivery. A refusal does not authorize a foreground retry. Verify the requested outcome from fresh state after an action; a delivered click alone does not prove the outcome. After cancellation, inspect current state before retrying because completed input is not rolled back. Other sessions and applications may change the same desktop.

On macOS, cursor-overlay operations may return facility_unavailable even when screenshots and input work.`

/** One live native runtime: the provider reservation plus its tools, guidance, and SDK handle. */
interface NativeMount {
  /** Resolves after native import, runtime creation, and tool discovery complete. */
  readonly ready: Promise<void>
  /** Abort native discovery and pending calls owned by this mount. */
  readonly abort: () => void
  /** Remove registrations and await native shutdown; the reservation releases last. */
  readonly dispose: () => Promise<void>
}

/**
 * Serializes the desired mount state into start/stop transitions. One
 * transition runs at a time, and a stop always awaits the start it interrupts,
 * so a rapid toggle can never resurrect a superseded native runtime.
 */
class NativeRuntimeController {
  private desired: boolean
  private booted = false
  private active: NativeMount | undefined
  private tail: Promise<void> = Promise.resolve()
  /**
   * Set by every desired-state change. A start that fails after a newer change
   * was recorded is superseded, not a startup failure: the queued transition
   * owns the next state, so the rejection is contained instead of failing
   * activation or reporting a stale runtime.
   */
  private generation = 0

  /**
   * @param ctx - owning plugin context; every mount effect is registered on it.
   * @param desired - the composition mount state before settings are read.
   */
  constructor(
    private readonly ctx: Context,
    desired: boolean,
  ) {
    this.desired = desired
  }

  /**
   * Establish the boot state; resolves once the desired runtime is mounted (or
   * stays unmounted) and rejects when an enabled runtime cannot start.
   * @param enabled - the composed and durably resolved mount state.
   * @returns settlement after the initial transition.
   */
  initialize(enabled: boolean): Promise<void> {
    this.desired = enabled
    this.generation += 1
    this.booted = true
    return this.enqueue()
  }

  /**
   * Apply a later settings change. The transition settles whether or not it
   * succeeds; a failed start is logged and leaves the runtime unmounted.
   * @param enabled - the desired mount state.
   */
  request(enabled: boolean): void {
    this.desired = enabled
    this.generation += 1
    // Cordis runs the settings injection callback that owns this call only
    // after initialize() records the boot state, so the guard is unreachable
    // in tests; it keeps a pre-boot change from racing the boot transition.
    /* v8 ignore next -- the settings injection callback runs after initialize() records the boot state */
    if (!this.booted) return
    // A disable aborts the active mount's native work immediately: an
    // in-flight start must not stall the stop behind an unbounded discovery.
    if (!enabled) this.active?.abort()
    void this.enqueue().catch((error: unknown) => { this.ctx.logger.error(error) })
  }

  /** Abort the active mount's native work without releasing its registration. */
  abort(): void {
    this.active?.abort()
  }

  /**
   * Stop the active runtime and await quiescence.
   * @returns settlement after the transition; a failed shutdown keeps its reservation.
   */
  async dispose(): Promise<void> {
    this.desired = false
    this.generation += 1
    this.booted = true
    this.active?.abort()
    await this.enqueue()
  }

  private enqueue(): Promise<void> {
    const task = this.tail.then(() => this.reconcile())
    // Keep the queue fulfilled so one failed transition cannot strand the next.
    this.tail = task.then(() => {}, () => {})
    return task
  }

  private async reconcile(): Promise<void> {
    const want = this.desired
    if (want === (this.active !== undefined)) return
    if (want) {
      const generation = this.generation
      const mount = createMount(this.ctx)
      this.active = mount
      try {
        await mount.ready
      } catch (error) {
        this.active = undefined
        await mount.dispose().catch((rollback: unknown) => { this.ctx.logger.error(rollback) })
        // A newer desired state superseded this start; its queued transition
        // owns the outcome, so only a start that still stands reports failure.
        if (this.generation !== generation) return
        throw error
      }
      return
    }
    const mount = this.active
    this.active = undefined
    /* v8 ignore next -- the equality check above guarantees an active mount here */
    if (mount === undefined) return
    await mount.dispose()
  }
}

/**
 * Own one native runtime and expose its catalog through the MCP result adapter.
 * Startup failures roll back every registration. Disposal removes tools, aborts
 * calls and image admission, awaits settlement and SDK shutdown, then releases
 * computer use.
 * @param ctx - context providing the exclusive registration and tool services.
 * @returns the mount's readiness, abort, and disposal handles.
 */
function createMount(ctx: Context): NativeMount {
  const lifetime = new AbortController()
  const pending = new Set<Promise<unknown>>()
  let driver: NativeDriver | undefined
  // Cordis announces disposal before it awaits asynchronous plugin startup.
  let ready: Promise<void> = Promise.resolve()
  const dispose = ctx.effect(function* () {
    yield ctx.computerUse.register(ComputerUseProviderName('cua-driver-native'))
    yield async () => {
      lifetime.abort()
      // apply() reports startup failure; teardown still owns its native handle.
      await ready.catch(() => {})
      await Promise.allSettled(pending)
      if (driver !== undefined) {
        await driver.shutdown()
        driver.uniffiDestroy()
      }
    }
    const child = ctx.plugin({
      name: 'computer-use-cua-driver-native-runtime',
      inject: ['tools', 'systemPrompt'],
      apply: mountRuntime,
    })
    yield child.dispose
    ready = Promise.resolve(child).then(() => {})
  }, 'computer-use-cua-driver-native.runtime')

  /** The child owns tool registrations; the outer effect owns native teardown. */
  async function mountRuntime(inner: Context): Promise<void> {
    const { CuaDriver } = await import('@trycua/cua-driver')
    lifetime.signal.throwIfAborted()
    // The generated constructor returns its class with an owned binding handle,
    // but declares only CuaDriverLike, which omits uniffiDestroy().
    const activeDriver = driver = CuaDriver.create(undefined) as NativeDriver
    const catalog = ToolCatalog.parse(JSON.parse(await activeDriver.listToolsJson({ signal: lifetime.signal })))
    lifetime.signal.throwIfAborted()
    const names = new Set<string>()
    for (const tool of catalog.tools) {
      const publicName = `cua_driver_native__${tool.name}`
      if (!TOOL_NAME.test(publicName)) {
        throw new Error(`Cua Driver tool "${tool.name}" exceeds the supported function-name format`)
      }
      if (names.has(publicName)) throw new Error(`Cua Driver listed tool "${tool.name}" more than once`)
      names.add(publicName)
      const definition = createMcpToolDefinition(inner, {
        name: publicName,
        rawName: tool.name,
        description: tool.description ?? '',
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        async call(args, signal) {
          const combined = AbortSignal.any([signal, lifetime.signal])
          combined.throwIfAborted()
          const result = await activeDriver.callTool(tool.name, JSON.stringify(args), { signal: combined })
          combined.throwIfAborted()
          return JSON.parse(result.rawJson) as unknown
        },
      })
      inner.tools.register(definition)
    }
    inner.on('tools/execute', async (exec, next) => {
      if (!names.has(exec.name)) return next()
      const upstream = exec.signal
      exec.signal = AbortSignal.any([upstream, lifetime.signal])
      const operation = Promise.resolve().then(next)
      pending.add(operation)
      try {
        return await operation
      } finally {
        pending.delete(operation)
        exec.signal = upstream
      }
    })
    inner.systemPrompt.section({
      name: 'computer-use:cua-driver-native',
      order: inner.systemPrompt.getSectionOrder('TOOL_COMPUTER_USE'),
      text: GUIDANCE,
    })
  }

  return { ready, abort: () => { lifetime.abort() }, dispose }
}

/**
 * Register the exclusive computer-use reservation and mount the native runtime
 * while the durable settings section leaves `enabled` true. A settings change
 * tears the runtime down or initializes it again; the initial enabled mount
 * must succeed or activation fails.
 * @param ctx - context providing the exclusive registration and tool services.
 * @param config - composition configuration supplying the settings base layer.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const entry: RuntimeSettings = { [ENABLED_FIELD]: config.enabled }
  let source: () => RuntimeSettings = () => entry
  const runtime = new NativeRuntimeController(ctx, entry.enabled)
  ctx.on('internal/plugin', (fiber) => {
    if (fiber === ctx.fiber && fiber.uid === null) runtime.abort()
  }, { global: true })
  ctx.effect(() => () => runtime.dispose(), 'computer-use-cua-driver-native.control')
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, SETTINGS_NAMESPACE, Config, entry, {
      setSource: (current) => { source = current },
      onChange: () => { runtime.request(source().enabled) },
    })
  })
  await runtime.initialize(source().enabled)
}
