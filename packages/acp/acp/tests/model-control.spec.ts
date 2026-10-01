import { describe, expect, it, vi } from 'vitest'
import { ReasoningEffortId, type LlmRuntime } from '@deepseek-ai/dsh-llm'
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

  it('synthesizes an unlisted current route and offers exactly its declared efforts', async () => {
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
    // The rows are exactly this route's declared efforts (low/high), not a
    // fixed ladder. The current value is the stored intent, so a route that
    // materializes its own default does not report one the person never picked.
    expect(reasoning).toMatchObject({
      type: 'select',
      currentValue: '',
      options: [
        { value: '', name: 'Default' },
        { value: 'low', name: 'Low' },
        { value: 'high', name: 'High' },
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

  it('rejects a level the route does not declare and accepts a later declared change', async () => {
    const control = new AcpModelControl(llmRuntime(), { provider: 'mock', model: 'mock' })

    await expect(control.set('reasoning_effort', 'extreme')).rejects.toThrow(/unknown reasoning effort/)
    const options = await control.set('reasoning_effort', 'low')

    expect(options.find(option => option.id === 'reasoning_effort')).toMatchObject({ currentValue: 'low' })
  })

  it('rejects an unsupported level and leaves the previous selection unchanged', async () => {
    // The route declares low/high only, so `max` has no row to pick. The control
    // refuses the mutation instead of storing an intent the next request could
    // never carry.
    const control = new AcpModelControl(llmRuntime(), { provider: 'mock', model: 'mock' })
    await control.set('reasoning_effort', 'low')

    await expect(control.set('reasoning_effort', 'max')).rejects.toThrow(/unknown reasoning effort/)

    expect(control.selection.current).toEqual({
      provider: 'mock', model: 'mock', reasoningEffort: 'low',
    })
    const options = await control.options()
    expect(options.find(option => option.id === 'reasoning_effort')).toMatchObject({ currentValue: 'low' })
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
        { value: 'low', name: 'Low' },
        { value: 'high', name: 'High' },
      ],
    })
    await control.set('reasoning_effort', 'low')
    const restored = await control.set('reasoning_effort', '')

    expect(restored.find(option => option.id === 'reasoning_effort')).toMatchObject({ currentValue: '' })
    expect(control.selection.current).toEqual({ provider: 'mock', model: 'mock' })
  })

  it('omits the reasoning option when the route declares no reasoning metadata', async () => {
    const runtime = llmRuntime({
      resolveModelInfo: (provider: string, model: string) => Promise.resolve({
        provider,
        id: model,
        name: model,
      }),
    })
    const control = new AcpModelControl(runtime, { provider: 'mock', model: 'mock' })

    const options = await control.options()

    expect(options.map(option => option.id)).toEqual(['model'])
    expect(options.find(option => option.id === 'reasoning_effort')).toBeUndefined()
    // No row is advertised, so no effort is settable on this route either.
    await expect(control.set('reasoning_effort', 'low')).rejects.toThrow(/unknown reasoning effort/)
    expect(control.selection.current).toEqual({ provider: 'mock', model: 'mock' })
  })

  it('omits the reasoning option when the route declares an empty effort list', async () => {
    const runtime = llmRuntime({
      resolveModelInfo: (provider: string, model: string) => Promise.resolve({
        provider,
        id: model,
        name: model,
        reasoning: { efforts: [] },
      }),
    })
    const control = new AcpModelControl(runtime, { provider: 'mock', model: 'mock' })

    const options = await control.options()

    expect(options.map(option => option.id)).toEqual(['model'])
  })

  it('keeps a stored effort the route no longer declares as an Unsupported current choice', async () => {
    const control = new AcpModelControl(llmRuntime(), {
      provider: 'mock',
      model: 'mock',
      reasoningEffort: ReasoningEffortId('max'),
    })

    const options = await control.options()

    // The route declares low/high only, so `max` has no supported row. It stays
    // visible as the current choice instead of silently reporting Default, and
    // rendering leaves the stored intent untouched.
    expect(options.find(option => option.id === 'reasoning_effort')).toMatchObject({
      type: 'select',
      currentValue: 'max',
      options: [
        { value: '', name: 'Default' },
        { value: 'low', name: 'Low' },
        { value: 'high', name: 'High' },
        { value: 'max', name: 'Unsupported: max' },
      ],
    })
    expect(control.selection.current).toEqual({
      provider: 'mock', model: 'mock', reasoningEffort: 'max',
    })

    // The unsupported row cannot be chosen; Default clears the stale intent.
    await expect(control.set('reasoning_effort', 'max')).rejects.toThrow(/unknown reasoning effort/)
    const cleared = await control.set('reasoning_effort', '')
    expect(cleared.find(option => option.id === 'reasoning_effort')).toMatchObject({ currentValue: '' })
    expect(control.selection.current).toEqual({ provider: 'mock', model: 'mock' })
  })

  it('keeps a stored effort visible and clearable when the route declares no reasoning metadata', async () => {
    const runtime = llmRuntime({
      resolveModelInfo: (provider: string, model: string) => Promise.resolve({
        provider,
        id: model,
        name: model,
      }),
    })
    const control = new AcpModelControl(runtime, {
      provider: 'mock',
      model: 'mock',
      reasoningEffort: ReasoningEffortId('low'),
    })

    const options = await control.options()

    expect(options.find(option => option.id === 'reasoning_effort')).toMatchObject({
      type: 'select',
      currentValue: 'low',
      options: [
        { value: '', name: 'Default' },
        { value: 'low', name: 'Unsupported: low' },
      ],
    })

    await expect(control.set('reasoning_effort', 'low')).rejects.toThrow(/unknown reasoning effort/)
    const cleared = await control.set('reasoning_effort', '')
    // With the stale intent cleared and no declared efforts, the route offers
    // no effort control at all.
    expect(cleared.find(option => option.id === 'reasoning_effort')).toBeUndefined()
    expect(control.selection.current).toEqual({ provider: 'mock', model: 'mock' })
  })
})
