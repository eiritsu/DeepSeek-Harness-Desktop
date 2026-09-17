/**
 * Per-agent loop-hygiene guard. Exact successful/ordinary calls receive
 * advisory reminders, while repeated schema-invalid calls receive corrective
 * context and eventually stop the current turn. Configuration and chain
 * semantics live in the package README; rationale lives in the
 * repeat-tool-reminder Agent Note.
 * @module @deepseek-ai/dsh-repeat-tool-reminder
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MessageSource } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { SANDBOX_ESCALATION_INVALID } from '@deepseek-ai/dsh-sandbox'
import type { PostToolDecision, ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'

export const name = 'repeat-tool-reminder'

/**
 * Structured result codes this guard classifies as caller-fixable and feeds
 * into the corrective invalid-call chain (reminder at the reminder threshold,
 * turn stop at the stop threshold). `INVALID_ARGS` covers schema-validation
 * failures; `SANDBOX_ESCALATION_INVALID` covers escalation requests that are
 * malformed or not strictly wider than the call's effective mode. The chain
 * keys on the CODE alone, so message variants of one failure class accumulate
 * — a model alternating `danger-full-access` and `workspace-write` escalation
 * targets otherwise resets two message-keyed chains forever, which is the
 * exact production loop this integration closes. Approval outcomes
 * (rejection, cancellation, unavailability) stay OUT: they are policy
 * decisions about a well-formed request, not repeated argument defects.
 */
const CALLER_FIXABLE_CODES: readonly string[] = ['INVALID_ARGS', SANDBOX_ESCALATION_INVALID]

/** Whether one tool result's structured error code joins the invalid-call chain. */
function callerFixableCode(code: string | undefined): code is string {
  return code !== undefined && CALLER_FIXABLE_CODES.includes(code)
}

/**
 * Plugin config, validated by the same-named schemastery schema plus the
 * load-time checks in `apply` (misconfiguration fails loud: an empty
 * `thresholds` list, a non-integer, a value below 2, a duplicate, or invalid
 * ordered INVALID_ARGS thresholds throws at plugin load, never a silent
 * fall-back). `include`/`exclude` entries are
 * `*`-wildcard predicates over tool names at call time, not references to
 * registry entries — a pattern matching no currently registered tool is valid
 * (`exclude: [mcp_*]` must stay legal in a deployment that loads no MCP tools).
 */
export interface Config {
  /** Consecutive-repeat counts that trigger a reminder (default `[3, 5, 8]`). */
  thresholds?: number[]
  /** Tool-name patterns to track; empty means every tool is tracked. */
  include?: string[]
  /** Tool-name patterns transparent to the chain (neither count nor reset). */
  exclude?: string[]
  /**
   * Maximum characters of canonical arguments quoted in the DETAILED reminder
   * (default 500). Large payloads (a `write` body, a long command) would
   * otherwise ride into the next request unbounded — precisely in a loop
   * scenario; the cap bounds the reminder, never the detection (the chain key
   * always compares the FULL canonical string).
   */
  argumentsPreviewChars?: number
  /** Repeated invalid-call count that injects a correction reminder (default 2). */
  invalidArgsReminderThreshold?: number
  /** Repeated invalid-call count that stops the current turn after its result (default 3). */
  invalidArgsStopThreshold?: number
}

export const Config: z<Config> = z.object({
  thresholds: z.array(z.number()).default([3, 5, 8]),
  include: z.array(z.string()).default([]),
  exclude: z.array(z.string()).default([]),
  argumentsPreviewChars: z.number().default(500),
  invalidArgsReminderThreshold: z.number().default(2),
  invalidArgsStopThreshold: z.number().default(3),
})

/**
 * The `{kind:'plugin'}` source stamped on every reminder this guard injects —
 * the label is load-bearing (an unlabeled context would render as a user
 * prompt in derived history).
 */
const PLUGIN_SOURCE: MessageSource = { kind: 'plugin', plugin: 'repeat-tool-reminder' }

/**
 * The gentle first-threshold reminder. Keyed to `thresholds[0]`, not a literal
 * count, so a custom first threshold keeps the gentle-then-detailed escalation.
 */
const GENTLE_REMINDER =
  'You are repeating the exact same tool call with identical arguments. '
  + 'Carefully analyze the previous result before calling again: if the task is '
  + 'not complete, try a different approach or different arguments instead of '
  + 'repeating the call.'

/** The detailed later-threshold reminder naming the tool, the run length, and the canonical arguments. */
function detailedReminder(toolName: string, count: number, canonicalArguments: string): string {
  return 'Repeated tool call detected:\n'
    + `- tool: ${toolName}\n`
    + `- consecutive_calls: ${count}\n`
    + `- arguments: ${canonicalArguments}\n`
    + 'The repeated calls are not making progress. Do not call this tool with '
    + 'these exact arguments again. Inspect the latest result and choose a '
    + 'different action, different arguments, or finish the task if enough '
    + 'evidence has been gathered.'
}

/** Corrective context for repeated caller-fixable failures whose arguments vary. */
function invalidArgsReminder(toolName: string, count: number, message: string): string {
  return 'Tool argument validation failed repeatedly:\n'
    + `- tool: ${toolName}\n`
    + `- consecutive_failures: ${count}\n`
    + `- error: ${message}\n`
    + 'Do not repeat another variant of the same invalid call. Re-read the tool schema '
    + 'and the current runtime policy, and either fix the request or drop the invalid '
    + 'fields entirely. For a required code field, put executable program text in code '
    + 'rather than prose in description; run_code requires both, for example: '
    + '{"code":"return await tools.name({})","description":"Run named tool"}.'
}

/**
 * Deep key-sort of a parsed-JSON value so two argument objects that differ
 * only in property order canonicalize identically. Arguments reach the guard
 * as the loop's `JSON.parse` output (or its raw-string fallback for malformed
 * argument JSON), so JSON's value domain is the whole input domain — no
 * bigint, cycle, or `undefined` handling exists because no input path can
 * produce them.
 */
function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue)
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortJsonValue(record[key])
    }
    return sorted
  }
  return value
}

/** Canonical string form of a call's arguments: deep key-sort, then stringify. */
function canonicalize(argumentsValue: unknown): string {
  return JSON.stringify(sortJsonValue(argumentsValue))
}

/** Compile one `*`-wildcard pattern to an anchored RegExp (every other regex metacharacter is matched literally). */
function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, String.raw`\$&`)
  return new RegExp(`^${escaped.replaceAll('*', '.*')}$`)
}

/**
 * Head-truncate the canonical arguments for quoting in the detailed reminder,
 * marking how much was omitted. Bounds only the model-visible text — the
 * chain key always uses the full canonical string.
 */
function previewArguments(canonical: string, cap: number): string {
  if (canonical.length <= cap) return canonical
  return `${canonical.slice(0, cap)}… (+${canonical.length - cap} more chars)`
}

/**
 * Validate `thresholds` per the fail-loud contract and return them sorted
 * ascending (the escalation rule reads `thresholds[0]` as the gentle tier, so
 * order is normalized here, once).
 */
function validateThresholds(values: number[]): number[] {
  if (values.length === 0) {
    throw new Error('repeat-tool-reminder: `thresholds` must not be empty')
  }
  for (const value of values) {
    if (!Number.isInteger(value) || value < 2) {
      throw new Error(`repeat-tool-reminder: invalid threshold ${value} — every threshold must be an integer >= 2`)
    }
  }
  if (new Set(values).size !== values.length) {
    throw new Error('repeat-tool-reminder: `thresholds` must not contain duplicates')
  }
  return [...values].sort((a, b) => a - b)
}

/**
 * Prepend the guard's reminder while preserving every downstream context's
 * source and metadata.
 */
function prependContext(ours: UserMessage, theirs: UserMessage[] | undefined): UserMessage[] {
  return [ours, ...theirs ?? []]
}

/** One agent's consecutive-repeat chain: the last tracked call's identity key and its run length. */
interface Chain {
  key: string
  count: number
}

/**
 * Install the guard's listeners.
 * @param ctx - plugin context; listeners are scoped to it and disposed with it.
 * @param config - validated {@link Config}; `thresholds` is re-checked fail-loud here.
 */
export function apply(ctx: Context, config: Config): void {
  // schemastery's .default() guarantees the fields are set after validation.
  const thresholds = validateThresholds(config.thresholds as number[])
  const thresholdSet = new Set(thresholds)
  const includePatterns = (config.include as string[]).map(wildcardToRegExp)
  const excludePatterns = (config.exclude as string[]).map(wildcardToRegExp)
  const argumentsPreviewChars = config.argumentsPreviewChars as number
  if (!Number.isInteger(argumentsPreviewChars) || argumentsPreviewChars < 1) {
    throw new Error(`repeat-tool-reminder: invalid argumentsPreviewChars ${argumentsPreviewChars} — must be an integer >= 1`)
  }
  const invalidArgsReminderThreshold = config.invalidArgsReminderThreshold as number
  const invalidArgsStopThreshold = config.invalidArgsStopThreshold as number
  if (!Number.isInteger(invalidArgsReminderThreshold) || invalidArgsReminderThreshold < 1) {
    throw new Error('repeat-tool-reminder: invalidArgsReminderThreshold must be a positive integer')
  }
  if (!Number.isInteger(invalidArgsStopThreshold) || invalidArgsStopThreshold <= invalidArgsReminderThreshold) {
    throw new Error('repeat-tool-reminder: invalidArgsStopThreshold must be an integer greater than invalidArgsReminderThreshold')
  }

  const chains = new WeakMap<Agent, Chain>()
  const halted = new WeakSet<Agent>()

  /** Whether a tool participates in the chain (untracked calls are transparent: they neither count nor reset). */
  function tracked(toolName: string): boolean {
    if (includePatterns.length > 0 && !includePatterns.some(pattern => pattern.test(toolName))) return false
    return !excludePatterns.some(pattern => pattern.test(toolName))
  }

  /**
   * Advance the calling agent's chain for one attempt and return the reminder
   * to deliver, if this attempt's run length hits a configured threshold.
   * Counting happens here — in post-execute — because denied calls also flow
   * through this waterfall (`ToolRuntime.execute` routes a deny through the
   * same pipeline), and a model hammering a denied call is exactly the loop
   * worth breaking.
   */
  function observe(exec: ToolExecution, result: Readonly<ToolExecutionResult>): UserMessage | undefined {
    // A direct `ctx.tools.execute()` caller has no model to remind and no id
    // to key on; only agent-loop calls participate.
    if (!exec.agent) return undefined
    if (!tracked(exec.name)) return undefined
    const invalidCode = result.isError && callerFixableCode(result.error.info?.code)
      ? result.error.info.code
      : undefined
    const canonical = invalidCode === undefined ? canonicalize(exec.arguments) : invalidCode
    const key = JSON.stringify([exec.name, invalidCode === undefined ? canonical : 'INVALID', invalidCode ?? canonical])
    const chain = chains.get(exec.agent)
    const count = chain !== undefined && chain.key === key ? chain.count + 1 : 1
    chains.set(exec.agent, { key, count })

    if (invalidCode !== undefined) {
      if (count >= invalidArgsStopThreshold) halted.add(exec.agent)
      if (count !== invalidArgsReminderThreshold) return undefined
      return createUserMessage({
        content: [{ type: 'text', text: invalidArgsReminder(exec.name, count, result.error?.message ?? 'unknown caller-fixable failure') }],
        source: { ...PLUGIN_SOURCE, form: 'notice', summary: `${exec.name} invalid × ${count}` },
      })
    }

    if (!thresholdSet.has(count)) return undefined
    const text = count === thresholds[0]
      ? GENTLE_REMINDER
      : detailedReminder(exec.name, count, previewArguments(canonical, argumentsPreviewChars))
    return createUserMessage({
      content: [{ type: 'text', text }],
      source: { ...PLUGIN_SOURCE, form: 'notice', summary: `${exec.name} × ${count}` },
    })
  }

  // Count before delegating so denied and invalid calls participate. A later
  // listener may still block or replace; this guard only adds corrective
  // context, except that repeated caller-fixable failures stop the next model
  // step.
  ctx.on('tools/post-execute', async (exec, result, next): Promise<PostToolDecision> => {
    const reminder = observe(exec, result)
    const downstream = await next()
    if (!reminder) return downstream
    if (downstream.kind === 'block') {
      return { kind: 'block', feedback: downstream.feedback, additionalContexts: prependContext(reminder, downstream.additionalContexts) }
    }
    return {
      ...downstream,
      additionalContexts: prependContext(reminder, downstream.additionalContexts),
    }
  })

  // A user interjection resets every chain and any pending stop. Without a new
  // user message, the stop threshold rejects the next model step and closes the
  // current turn as blocked instead of allowing an unbounded invalid-call loop.
  ctx.on('agent/pre-step', ({ agent, messages }, next): Promise<PreStepDecision> => {
    if (messages.some(message => message.source.kind === 'user')) {
      chains.delete(agent)
      halted.delete(agent)
      return next()
    }
    if (halted.delete(agent)) {
      chains.delete(agent)
      return Promise.resolve({ kind: 'reject' })
    }
    return next()
  })
}
