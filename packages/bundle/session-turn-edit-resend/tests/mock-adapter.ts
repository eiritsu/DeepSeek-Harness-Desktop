/** Scripted adapter for the edit-and-resend specs: every request is recorded. */

import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'

/** Stream one plain text answer. */
export function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/** Stream one tool call, which the loop records as a `tool/call` for the turn. */
export function toolCallResponse(callId: string, name: string, args: object): StreamChunk[] {
  const id = ToolCallId(callId)
  const argsJson = JSON.stringify(args)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: argsJson },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: argsJson } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

/** Script entry: stream one partial delta, then hold the turn open until aborted. */
export const HANG = 'hang'

/** Script entry: hold the turn open with no output at all until aborted, so the turn records no assistant message. */
export const SILENT_HANG = 'silent-hang'

/** One scripted model call. */
export type ScriptEntry = StreamChunk[] | typeof HANG | typeof SILENT_HANG

/** Adapter that answers each model call from a fixed script. */
export class MockAdapter extends LlmAdapter {
  /** Every request the loop issued, in order. */
  readonly requests: GenerateOptions[] = []
  private readonly script: ScriptEntry[]
  private readonly requestWaiters: Array<() => void> = []

  constructor(script: ScriptEntry[]) {
    super()
    this.script = script
  }

  /**
   * Resolve when the next model stream begins, so a test can synchronize on the
   * driver actually reaching the provider instead of polling.
   * @returns fulfillment after `stream` records the next request.
   */
  whenRequested(): Promise<void> {
    return new Promise<void>((resolve) => { this.requestWaiters.push(resolve) })
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    for (const resolve of this.requestWaiters.splice(0)) resolve()
    const entry = this.script.shift()
    if (entry === undefined) throw new Error('MockAdapter: script exhausted')
    if (entry === SILENT_HANG) {
      await new Promise<void>((_resolve, reject) => {
        const fail = (): void => { reject(new Error('aborted')) }
        if (options.signal?.aborted === true) { fail(); return }
        options.signal?.addEventListener('abort', fail, { once: true })
      })
      return
    }
    if (entry === HANG) {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'partial' }
      await new Promise<void>((_resolve, reject) => {
        const fail = (): void => { reject(new Error('aborted')) }
        if (options.signal?.aborted === true) { fail(); return }
        options.signal?.addEventListener('abort', fail, { once: true })
      })
      return
    }
    for (const chunk of entry) yield chunk
  }
}
