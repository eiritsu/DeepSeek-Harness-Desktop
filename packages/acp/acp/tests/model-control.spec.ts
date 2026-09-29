import { describe, expect, it, vi } from 'vitest'
import { LlmError, ReasoningEffortId, type LlmRuntime } from '@deepseek-ai/dsh-llm'
import { AcpModelControl } from '../src/model-control.ts'

/** Minimal LLM catalog/runtime double for pure standard-option tests. */
function llmRuntime(overrides: Partial<LlmRuntime> = {}): LlmRuntime {
  return {
    listProviders: () => [{ id: 'mock', name: 'Mock' }],
    listModels: () => Promise.resolve([{ provider: 'mock', id: 'mock', name: 'Mock' }]),
    resolveCallConfig: (selection: { provider?: string; model?: string; reasoningEffort?: string }) => Promise.resolve({
      provider: selection.provider ?? 'mock',
      model: selection.model ?? 'mock',
      ...selection.reasoningEffort === undefined
        ? { reasoningEffort: ReasoningEffortId('high') }
        : { reasoningEffort: ReasoningEffortId(selection.reasoningEffort) },
    }),
    resolveModelInfo: (provider: string, model: string) => Promise.resolve({
      provider,
      id: model,
      name: model,
      reasoning: {
        efforts: [
          { id: ReasoningEffortId('low'), name: 'Low', description: 'Less thought.' },
          { id: ReasoningEffortId('high'), name: 'High' },
        ],
        defaultEffort: ReasoningEffortId('high'),
      },
    }),
    ...overrides,
  } as unknown as LlmRuntime
}

describe('ACP model configuration control', () => {
  it('represents an absent route and validates value types before mutation', async () => {
    const control = new AcpModelControl(llmRuntime(), undefined)

    expect(control.snapshot()).toBeUndefined()
    await expect(control.options()).resolves.toEqual([])
    await expect(control.set('model', false)).rejects.toThrow(/requires a select value/)
    await expect(control.set('model', 'missing')).rejects.toThrow(/no model selection/)

    control.selection.current = { provider: 'mock', model: 'mock' }
    expect(control.selection.current).toEqual({ provider: 'mock', model: 'mock' })
  })

  it('synthesizes an unlisted current route and offers the fixed reasoning ladder', async () => {
    const control = new AcpModelControl(llmRuntime({ listProviders: () => [] }), {
      provider: 'private',
      model: 'unlisted',
    })

    const options = await control.options()

    const model = options.find(option => option.id === 'model')
    const reasoning = options.find(option => option.id === 'reasoning_effort')
    expect(model).toMatchObject({
      type: 'select',
      currentValue: '["private","unlisted"]',
      options: [{ group: 'private', name: 'private', options: [{ name: 'unlisted' }] }],
    })
    // Every model offers the same seven rows, whatever this route encodes.
    // The current value is the stored intent, so a route that materializes its
    // own default does not report one the person never picked.
    expect(reasoning).toMatchObject({
      type: 'select',
      currentValue: '',
      options: [
        { value: '', name: 'Default' },
        { value: 'minimal', name: 'Minimal' },
        { value: 'low', name: 'Low' },
        { value: 'medium', name: 'Medium' },
        { value: 'high', name: 'High' },
        { value: 'xhigh', name: 'Extra high' },
        { value: 'max', name: 'Max' },
      ],
    })

    control.pinTurn(3, { provider: 'turn', model: 'pinned' })
    expect(control.selection.current).toEqual({ provider: 'turn', model: 'pinned' })
    control.releaseTurn(2)
    expect(control.selection.current).toEqual({ provider: 'turn', model: 'pinned' })
    control.releaseTurn(3)
    expect(control.selection.current).toEqual({ provider: 'private', model: 'unlisted' })
  })

  it('keeps the selected route when its provider catalog is temporarily unavailable', async () => {
    const listModels = vi.fn(() => Promise.reject(new Error('catalog unavailable')))
    const control = new AcpModelControl(llmRuntime({ listModels }), { provider: 'mock', model: 'mock' })

    const options = await control.options()

    expect(listModels).toHaveBeenCalledWith('mock')
    expect(options[0]).toMatchObject({
      type: 'select',
      options: [{ group: 'mock', options: [{ name: 'mock' }] }],
    })
  })

  it('rejects a level outside the canonical vocabulary and accepts a later valid change', async () => {
    const control = new AcpModelControl(llmRuntime(), { provider: 'mock', model: 'mock' })

    await expect(control.set('reasoning_effort', 'extreme')).rejects.toThrow(/unknown reasoning effort/)
    const options = await control.set('reasoning_effort', 'low')

    expect(options.find(option => option.id === 'reasoning_effort')).toMatchObject({ currentValue: 'low' })
  })

  it('stores a canonical level the route cannot encode and refuses it at request time', async () => {
    // The route encodes low/high only, so both runtime entries refuse `max` the
    // way `LlmRuntime` does. `max` is still a real harness level, and a person
    // may pick it for a route that cannot send it: the selection keeps it, and
    // the request that carries the intent answers UNSUPPORTED_REASONING_EFFORT
    // rather than dropping the level or failing the choice.
    const runtime = llmRuntime({
      resolveCallConfig: (selection: { provider?: string; model?: string; reasoningEffort?: string }) =>
        selection.reasoningEffort === 'max'
          ? Promise.reject(new LlmError('mock cannot send max', 'UNSUPPORTED_REASONING_EFFORT'))
          : Promise.resolve({
            provider: selection.provider ?? 'mock',
            model: selection.model ?? 'mock',
            ...selection.reasoningEffort === undefined
              ? { reasoningEffort: ReasoningEffortId('high') }
              : { reasoningEffort: ReasoningEffortId(selection.reasoningEffort) },
          }),
      // The request that carries `max` is where the route's refusal appears;
      // the control never asks the runtime to prepare another level here.
      prepareCall: () => Promise.reject(
        new LlmError('mock cannot send max', 'UNSUPPORTED_REASONING_EFFORT'),
      ),
    })
    const control = new AcpModelControl(runtime, {
      provider: 'mock', model: 'mock',
    })

    const options = await control.set('reasoning_effort', 'max')

    // Selection stores the intent as expressed; the option state reports it, and
    // the next request carries exactly what the person chose.
    expect(options.find(option => option.id === 'reasoning_effort')).toMatchObject({ currentValue: 'max' })
    expect(control.selection.current).toEqual({
      provider: 'mock', model: 'mock', reasoningEffort: 'max',
    })
    await expect(runtime.prepareCall(control.selection.current!)).rejects.toMatchObject({
      code: 'UNSUPPORTED_REASONING_EFFORT',
    })
  })

  it('keeps the Default row and reports the stored intent beside a materialized default', async () => {
    const runtime = llmRuntime({
      resolveCallConfig: (selection: { provider?: string; model?: string; reasoningEffort?: string }) => Promise.resolve({
        provider: selection.provider ?? 'mock',
        model: selection.model ?? 'mock',
        ...selection.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: ReasoningEffortId(selection.reasoningEffort) },
      }),
      resolveModelInfo: (provider: string, model: string) => Promise.resolve({
        provider,
        id: model,
        name: model,
        reasoning: {
          efforts: [
            { id: ReasoningEffortId('low'), name: 'Low' },
            { id: ReasoningEffortId('high'), name: 'High' },
          ],
        },
      }),
    })
    const control = new AcpModelControl(runtime, { provider: 'mock', model: 'mock' })

    const initial = await control.options()
    expect(initial.find(option => option.id === 'reasoning_effort')).toMatchObject({
      currentValue: '',
      options: [
        { value: '', name: 'Default' },
        { value: 'minimal', name: 'Minimal' },
        { value: 'low', name: 'Low' },
        { value: 'medium', name: 'Medium' },
        { value: 'high', name: 'High' },
        { value: 'xhigh', name: 'Extra high' },
        { value: 'max', name: 'Max' },
      ],
    })
    await control.set('reasoning_effort', 'low')
    const restored = await control.set('reasoning_effort', '')

    expect(restored.find(option => option.id === 'reasoning_effort')).toMatchObject({ currentValue: '' })
    expect(control.selection.current).toEqual({ provider: 'mock', model: 'mock' })
  })
})
