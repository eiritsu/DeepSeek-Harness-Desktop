/**
 * Model-facing read, read_image, write, and edit tools over `ctx.fs`. This package owns schemas, validation,
 * read windows, formatting, and observation events, never a concrete provider. An optional
 * event policy supplies mutation guards; without one the tools use unconditional provider calls.
 * @module @deepseek-ai/dsh-tool-fs
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-user-approval'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { escalationModesFor } from '@deepseek-ai/dsh-sandbox'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'
import { applyReadTool, READ_LIMIT, STREAM_MIN_SIZE } from './read.ts'
import { applyWriteTool, createWriteTool } from './write.ts'
import { applyEditTool, createEditTool } from './edit.ts'
import { applyReadImageTool } from './read-image.ts'
import { READ_MAX_BYTES, READ_MAX_LINE_LENGTH } from './read-render.ts'
import { FsSandboxController } from './sandbox.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-fs'

/** Services required by the filesystem tool suite. */
export const inject = ['tools', 'fs', 'systemPrompt']

/** Plugin config (all optional — `Config` supplies the defaults). */
export interface Config {
  /** Default and maximum number of lines returned by one `read` call. */
  readLimit?: number
  /** Maximum characters returned for a single line before truncation. */
  readMaxLineLength?: number
  /** Maximum bytes returned for the selected lines of one `read` call. */
  readMaxBytes?: number
  /** Files at or above this size stream instead of loading whole into memory. */
  readStreamMinSize?: number
}

export const Config: z<Config> = z.object({
  readLimit: z.number().default(READ_LIMIT),
  readMaxLineLength: z.number().default(READ_MAX_LINE_LENGTH),
  readMaxBytes: z.number().default(READ_MAX_BYTES),
  readStreamMinSize: z.number().default(STREAM_MIN_SIZE),
})

/** The shape after schemastery applied the defaults. */
type ResolvedConfig = Required<Config>

/** Every read cap counts lines/chars/bytes — a positive integer, or windowing arithmetic misbehaves silently. */
function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`tool-fs: ${name} must be a positive integer`)
  }
}

/** Register the full `read`/`write`/`edit` filesystem tool suite, plus `read_image` while `attachments` is mounted. */
export function apply(ctx: Context, config: Config): void {
  // schemastery (Config) has already filled every defaulted field.
  const resolved = config as ResolvedConfig
  assertPositiveInteger('readLimit', resolved.readLimit)
  assertPositiveInteger('readMaxLineLength', resolved.readMaxLineLength)
  assertPositiveInteger('readMaxBytes', resolved.readMaxBytes)
  assertPositiveInteger('readStreamMinSize', resolved.readStreamMinSize)
  applyReadTool(ctx, {
    limit: resolved.readLimit,
    maxLineLength: resolved.readMaxLineLength,
    maxBytes: resolved.readMaxBytes,
    streamMinSize: resolved.readStreamMinSize,
  })
  // read_image is composition-conditional: without a mounted attachment store
  // the deployment cannot durably commit image bytes, so the tool never
  // registers; the execute body keeps a defensive re-check for direct callers.
  ctx.inject(['attachments'], (imageCtx) => {
    applyReadImageTool(imageCtx)
  })
  // One escalation API shared by both mutating tools: advertisement gating,
  // per-call policy resolution, and denial-marker mapping, all keyed off whether
  // the mounted ctx.fs confines (ctx.fs.sandboxMode).
  const sandbox = new FsSandboxController(ctx)
  applyWriteTool(ctx, sandbox)
  applyEditTool(ctx, sandbox)

  const agents = ctx.get('agents')
  const sandboxPolicy = ctx.get('sandboxPolicy')
  const scopedFibers = new Map<Agent, () => void | Promise<void>>()
  const refreshScope = (agent: Agent, mode?: SandboxMode): void => {
    if (agent.ctx === undefined || scopeOf(agent.ctx) === undefined) return
    if (agent.ctx === undefined || scopeOf(agent.ctx) === undefined) return
    const previous = scopedFibers.get(agent)
    if (previous !== undefined) {
      scopedFibers.delete(agent)
      void previous()
    }
    const effectiveMode = mode ?? sandboxPolicy?.resolve({ session: agent.session }).mode
    const modes = escalationModesFor(effectiveMode)
    const fiber = agent.ctx.effect(() => {
      if (sandbox.escalationModes.length === 0) return () => {}
      const disposeWrite = agent.ctx.tools.register(createWriteTool(ctx, sandbox, modes))
      const disposeEdit = agent.ctx.tools.register(createEditTool(ctx, sandbox, modes))
      return () => {
        disposeEdit()
        return disposeWrite()
      }
    }, 'tool-fs: session schema shadows')
    scopedFibers.set(agent, fiber)
  }
  const removeScope = (agent: Agent): void => {
    const fiber = scopedFibers.get(agent)
    if (fiber === undefined) return
    scopedFibers.delete(agent)
    void fiber()
  }
  for (const agent of agents?.list() ?? []) refreshScope(agent)
  ctx.on('agent/created', ({ agent }) => { refreshScope(agent) })
  ctx.on('agent/disposed', ({ agent }) => { removeScope(agent) })
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'sandbox/mode') return
    const agent = agents?.get(session.id)
    if (agent !== undefined) refreshScope(agent, event.data.mode)
  })
  ctx.effect(() => async () => {
    const fibers = [...scopedFibers.values()]
    scopedFibers.clear()
    await Promise.all(fibers.map(fiber => fiber()))
  }, 'tool-fs: session schema shadows')
}
