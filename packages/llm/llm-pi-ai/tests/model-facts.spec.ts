/**
 * The shared model catalog as this adapter reads it: which shared fact reaches
 * a described model, which reaches the wire, what a deployment's own
 * declaration keeps, and what one generation pins for one operation.
 */

import { afterEach, describe, expect, it } from 'vitest'
import type { GenerateOptions, LlmModelInfo, LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { ModelFacts, ModelFactsView } from '@deepseek-ai/dsh-model-catalog'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import type { PiAiModelProfile, PiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { resolveProfiles } from '../src/config.ts'
import { memoryAuth } from './auth-double.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

afterEach(async () => {
  await closeMockServers()
})

/** One published generation, keyed by the `owner/model` the adapter asks for. */
function generation(records: Record<string, ModelFacts>, number = 1): ModelFactsView {
  return {
    generation: number,
    facts: request => records[`${request.ownedBy ?? ''}/${request.model}`],
  }
}

/** The adapter over the real profile resolver, reading the current generation. */
function adapterOf(
  providers: Record<string, PiAiProviderProfile>,
  facts: () => ModelFactsView | undefined,
): PiAiAdapter {
  return new PiAiAdapter({
    profiles: () => resolveProfiles(providers),
    resolveApiKey: () => Promise.resolve('test-key'),
    auth: memoryAuth(),
    modelFacts: facts,
  })
}

/** The installed-catalog route pointed at a provider stand-in. */
function catalogRoute(baseURL: string): Record<string, PiAiProviderProfile> {
  return {
    deepseek: {
      api: 'openai-completions',
      baseURL,
      models: [
        { id: 'deepseek-v4-flash', contextWindow: 1_000_000, maxTokens: 65_536, input: ['text', 'image'], reasoningEfforts: { low: 'low', high: 'high' } },
        { id: 'deepseek-v4-flash-vision-exp', contextWindow: 1_000_000, maxTokens: 65_536, input: ['text', 'image'], reasoningEfforts: { low: 'low', high: 'high' } },
      ],
    },
  }
}

/** A hand-declared gateway, where every model fact comes from configuration. */
function gateway(baseURL: string, model: PiAiModelProfile): Record<string, PiAiProviderProfile> {
  return {
    'acme-gateway': {
      apiKeyEnv: 'PI_TEST_KEY',
      api: 'openai-completions',
      baseURL,
      models: [model],
    },
  }
}

/** The display name a catalog owns, which no shared fact replaces. */
function withoutName<T extends { name: string }>(described: T): Omit<T, 'name'> {
  const { name, ...rest } = described
  void name
  return rest
}

/** Decode provider bodies captured by the local HTTP boundary. */
function requestsOf(server: { requests: unknown[] }): Record<string, unknown>[] {
  return server.requests.map((request) => {
    if (typeof request !== 'object' || request === null || Array.isArray(request)) {
      throw new Error('mock provider request was not a JSON object')
    }
    return request as Record<string, unknown>
  })
}

/** Drive one prepared call far enough to reach the refusal it makes. */
async function firstChunk(options: GenerateOptions, adapter: PiAiAdapter): Promise<unknown> {
  const prepared = await adapter.prepareCall(options.provider ?? '', options.model)
  return prepared.stream(options)[Symbol.asyncIterator]().next()
}

describe('shared model facts', () => {
  it.each([
    ['openai-completions', 'https://api.minimax.cn/v1', 'completions'],
    ['openai-responses', 'https://api.minimax.cn/v1', 'responses'],
    ['anthropic-messages', 'https://api.minimax.cn/anthropic', 'anthropic'],
  ] as const)('serializes dynamic MiniMax toggle controls for %s and leaves Default untouched', async (api, _upstream, protocol) => {
    const server = await mockServer([
      { status: 401, body: '{}' },
      { status: 401, body: '{}' },
      { status: 401, body: '{}' },
    ])
    const route = {
      'minimax-cn-custom': {
        api,
        baseURL: protocol === 'anthropic' ? `${server.url}/anthropic` : `${server.url}/v1`,
        apiKeyEnv: 'PI_TEST_KEY',
        models: [{ id: 'MiniMax-M3' }],
      },
    }
    const facts = (): ModelFactsView => ({
      generation: 1,
      facts: request => request.model === 'MiniMax-M3'
        ? {
          canonicalId: 'minimax/MiniMax-M3',
          reasoning: true,
          reasoningControl: { type: 'toggle' },
        }
        : undefined,
    })
    const adapter = adapterOf(route, facts)
    const described = await adapter.resolveModel('minimax-cn-custom', 'MiniMax-M3')
    expect(described.reasoning).toMatchObject({
      control: 'toggle',
      efforts: [
        { id: ReasoningEffortId('off') },
        { id: ReasoningEffortId('on'), name: 'Enabled' },
      ],
    })
    const send = async (reasoningEffort?: string, maxTokens?: number): Promise<void> => {
      await firstChunk({
        provider: 'minimax-cn-custom',
        model: 'MiniMax-M3',
        messages: [],
        ...(maxTokens === undefined ? {} : { maxTokens }),
        ...(reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(reasoningEffort) }),
      }, adapter)
    }
    await send()
    await send('on', 256)
    await send('off')
    const requests = requestsOf(server)
    if (protocol === 'anthropic') {
      expect(requests[0]).not.toHaveProperty('thinking')
      expect(requests[1]).toMatchObject({ thinking: { type: 'adaptive' } })
      expect(requests[1]).not.toHaveProperty('output_config')
      expect(requests[1]).not.toHaveProperty('thinking_budget_tokens')
      expect(requests[1]).not.toHaveProperty('thinking.budget_tokens')
      expect(requests[1]).toHaveProperty('max_tokens', 256)
      expect(requests[2]).toMatchObject({ thinking: { type: 'disabled' } })
    } else if (protocol === 'completions') {
      expect(requests[0]).not.toHaveProperty('thinking')
      expect(requests[0]).not.toHaveProperty('reasoning_effort')
      expect(requests[1]).toMatchObject({ thinking: { type: 'adaptive' } })
      expect(requests[1]).not.toHaveProperty('reasoning_effort')
      expect(requests[2]).toMatchObject({ thinking: { type: 'disabled' } })
      expect(requests[2]).not.toHaveProperty('reasoning_effort')
    } else {
      expect(requests[0]).not.toHaveProperty('reasoning')
      expect(requests[0]).not.toHaveProperty('reasoning_effort')
      expect(requests[1]).toMatchObject({ reasoning: { effort: 'high' } })
      expect(requests[2]).toMatchObject({ reasoning: { effort: 'none' } })
    }
  })

  it('serializes dynamic MiniMax M3.1 effort declarations without Off on all three APIs', async () => {
    const efforts = ['low', 'medium', 'high', 'xhigh', 'max'] as const
    for (const api of ['openai-completions', 'openai-responses', 'anthropic-messages'] as const) {
      const server = await mockServer([{ status: 401, body: '{}' }, { status: 401, body: '{}' }])
      const adapter = adapterOf({
        'minimax-cn-plan': {
          api,
          baseURL: api === 'anthropic-messages' ? `${server.url}/anthropic` : `${server.url}/v1`,
          apiKeyEnv: 'PI_TEST_KEY',
          models: [{ id: 'MiniMax-M3.1-Flash-Preview' }],
        },
      }, () => ({
        generation: 1,
        facts: request => request.model === 'MiniMax-M3.1-Flash-Preview'
          ? {
            canonicalId: 'minimax/MiniMax-M3.1-Flash-Preview',
            reasoning: true,
            reasoningEfforts: efforts,
            reasoningControl: { type: 'effort', efforts },
          }
          : undefined,
      }))
      const described = await adapter.resolveModel('minimax-cn-plan', 'MiniMax-M3.1-Flash-Preview')
      expect(described.reasoning?.efforts.map(effort => effort.id)).toEqual(efforts.map(ReasoningEffortId))
      await expect(firstChunk({
        provider: 'minimax-cn-plan', model: 'MiniMax-M3.1-Flash-Preview', messages: [],
        reasoningEffort: ReasoningEffortId('on'),
      }, adapter)).rejects.toMatchObject({ code: 'UNSUPPORTED_REASONING_EFFORT' })
      expect(server.requests).toHaveLength(0)
      await firstChunk({
        provider: 'minimax-cn-plan', model: 'MiniMax-M3.1-Flash-Preview', messages: [],
      }, adapter)
      await firstChunk({
        provider: 'minimax-cn-plan', model: 'MiniMax-M3.1-Flash-Preview', messages: [],
        reasoningEffort: ReasoningEffortId('max'),
      }, adapter)
      const requests = requestsOf(server)
      expect(requests[0]).not.toHaveProperty('thinking')
      expect(requests[0]).not.toHaveProperty('output_config')
      expect(requests[0]).not.toHaveProperty('reasoning')
      if (api === 'openai-completions') expect(requests[1]).toMatchObject({ reasoning_effort: 'max' })
      else if (api === 'openai-responses') expect(requests[1]).toMatchObject({ reasoning: { effort: 'max' } })
      else expect(requests[1]).toMatchObject({ thinking: { type: 'adaptive' }, output_config: { effort: 'max' } })
    }
  })

  it('describes a model from the shared record, narrowed by what the transport encodes', async () => {
    // The installed catalog entry takes images and reasons at low, high, and
    // max. The shared record says text only, a smaller window, and the two
    // levels its channel accepts — and the transport still decides which of
    // those it can put on the wire.
    const server = await mockServer([])
    const adapter = adapterOf(catalogRoute(server.url), () => generation({
      'deepseek/deepseek-v4-flash-vision-exp': {
        canonicalId: 'deepseek/deepseek-v4-flash-vision-exp',
        inputModalities: ['text'],
        contextWindow: 4_096,
        reasoning: true,
        reasoningEfforts: ['low', 'high'],
      },
    }))

    const listed = (await adapter.listModels('deepseek'))
      .filter((model: LlmModelInfo) => model.id === 'deepseek-v4-flash-vision-exp')
    expect(listed.map(withoutName)).toEqual([{
      provider: 'deepseek', id: 'deepseek-v4-flash-vision-exp', inputModalities: ['text'],
    }])
    const described: LlmResolvedModelInfo = await adapter
      .resolveModel('deepseek', 'deepseek-v4-flash-vision-exp')
    expect(withoutName(described)).toEqual({
      provider: 'deepseek',
      id: 'deepseek-v4-flash-vision-exp',
      inputModalities: ['text'],
      context: { contextWindow: 4_096 },
      defaultMaxTokens: 65_536,
      reasoning: {
        efforts: [
          { id: ReasoningEffortId('low'), name: 'Low' },
          { id: ReasoningEffortId('high'), name: 'High' },
        ],
      },
    })
    // A model this record does not describe keeps the installed catalog's facts.
    await expect(adapter.resolveModel('deepseek', 'deepseek-v4-flash')).resolves.toMatchObject({
      context: { contextWindow: 1_000_000 },
      inputModalities: ['text', 'image'],
    })
  })

  it('refuses a level the shared record denies, before the request reaches a provider', async () => {
    const server = await mockServer([])
    const adapter = adapterOf(catalogRoute(server.url), () => generation({
      'deepseek/deepseek-v4-flash': {
        canonicalId: 'deepseek/deepseek-v4-flash',
        reasoning: false,
        reasoningEfforts: ['low', 'high'],
      },
    }))

    // A model the record says does not reason offers no control at all, so no
    // surface can offer one, and every explicit level is refused rather than
    // quietly answered with a neighboring one.
    const described = await adapter.resolveModel('deepseek', 'deepseek-v4-flash')
    expect(described.reasoning).toBeUndefined()
    await expect(firstChunk({
      provider: 'deepseek', model: 'deepseek-v4-flash',
      messages: [], reasoningEffort: ReasoningEffortId('high'),
    }, adapter)).rejects.toMatchObject({ code: 'UNSUPPORTED_REASONING_EFFORT' })
  })

  it('does not turn an explicit empty control declaration into generic reasoning levels', async () => {
    const server = await mockServer([])
    const adapter = adapterOf(gateway(`${server.url}/v1`, {
      id: 'MiniMax-M2.7-highspeed',
      contextWindow: 65_536,
      maxTokens: 4_096,
      input: ['text'],
    }), () => generation({
      'acme-gateway/MiniMax-M2.7-highspeed': {
        canonicalId: 'minimax/MiniMax-M2.7-highspeed',
        reasoning: true,
        reasoningEfforts: [],
        reasoningControl: { type: 'none' },
      },
    }))

    expect((await adapter.resolveModel('acme-gateway', 'MiniMax-M2.7-highspeed')).reasoning).toBeUndefined()
  })

  it('keeps native SDK budget levels and does not label them as catalog controls', async () => {
    const server = await mockServer([{ status: 401, body: '{}' }])
    const adapter = adapterOf({
      'acme-gateway': {
        apiKeyEnv: 'PI_TEST_KEY',
        api: 'anthropic-messages',
        baseURL: `${server.url}/anthropic`,
        reasoning: 'high',
        models: [{
          id: 'claude-budget',
          reasoningEfforts: { high: 'high' },
        }],
      },
    }, () => generation({
      'acme-gateway/claude-budget': {
        canonicalId: 'anthropic/claude-budget',
        reasoning: true,
        reasoningEfforts: ['low', 'high'],
        reasoningControl: { type: 'effort', efforts: ['low', 'high'], budget: true },
      },
    }))

    const info = await adapter.resolveModel('acme-gateway', 'claude-budget')
    expect(info.reasoning?.control).toBeUndefined()
    expect(info.reasoning?.efforts.map(effort => effort.id)).toEqual(['high'])
    await firstChunk({
      provider: 'acme-gateway', model: 'claude-budget', messages: [],
      reasoningEffort: ReasoningEffortId('high'),
    }, adapter)
    expect(requestsOf(server)[0]).toMatchObject({ thinking: { type: 'enabled' } })
  })

  it('does not invent a budget control for an unknown custom model', async () => {
    const server = await mockServer([])
    const adapter = adapterOf(gateway(`${server.url}/v1`, {
      id: 'unknown-budget',
      contextWindow: 65_536,
      maxTokens: 4_096,
      input: ['text'],
    }), () => generation({
      'acme-gateway/unknown-budget': {
        canonicalId: 'acme/unknown-budget',
        reasoning: true,
        reasoningControl: { type: 'toggle', budget: true },
      },
    }))

    expect((await adapter.resolveModel('acme-gateway', 'unknown-budget')).reasoning).toBeUndefined()
  })

  it('overrides a conflicting local declaration with the shared record', async () => {
    const server = await mockServer([{ events: textEvents }])
    const adapter = adapterOf(gateway(`${server.url}/v1`, {
      id: 'acme-think',
      contextWindow: 65_536,
      maxTokens: 4_096,
      input: ['text', 'image'],
      reasoningEfforts: { off: null, low: 'low', high: 'ultra', max: 'max' },
    }), () => generation({
      'acme-gateway/acme-think': {
        canonicalId: 'zhipuai/glm-5.3-flash',
        inputModalities: ['text'],
        contextWindow: 999_999,
        reasoning: true,
        reasoningEfforts: ['low', 'high'],
        maxOutputTokens: 2_048,
      },
    }))

    // The shared record's every field wins over the deployment's conflicting
    // one, while the request cap the deployment configured is not a model fact
    // and stays.
    await expect(adapter.resolveModel('acme-gateway', 'acme-think')).resolves.toMatchObject({
      inputModalities: ['text'],
      context: { contextWindow: 999_999 },
      defaultMaxTokens: 4_096,
      reasoning: {
        efforts: [
          { id: ReasoningEffortId('low'), name: 'Low' },
          { id: ReasoningEffortId('high'), name: 'High' },
        ],
      },
    })
    // A level only the local declaration offered is refused: the shared record
    // replaced that vocabulary, and the transport can encode it either way.
    await expect(firstChunk({
      provider: 'acme-gateway', model: 'acme-think', messages: [], reasoningEffort: ReasoningEffortId('max'),
    }, adapter)).rejects.toMatchObject({ code: 'UNSUPPORTED_REASONING_EFFORT' })
  })

  it('falls back to the local declaration for fields the shared record leaves open', async () => {
    const server = await mockServer([{ events: textEvents }])
    const adapter = adapterOf(gateway(`${server.url}/v1`, {
      id: 'acme-think',
      contextWindow: 65_536,
      maxTokens: 4_096,
      input: ['text', 'image'],
      reasoningEfforts: { off: null, high: 'ultra' },
    }), () => generation({
      // The channel record carries no modalities, limit, or reasoning options,
      // so the deployment's own declaration is the answer for each.
      'acme-gateway/acme-think': { canonicalId: 'zhipuai/glm-5.3-flash' },
    }))

    await expect(adapter.resolveModel('acme-gateway', 'acme-think')).resolves.toMatchObject({
      inputModalities: ['text', 'image'],
      context: { contextWindow: 65_536 },
      defaultMaxTokens: 4_096,
      reasoning: {
        efforts: [
          { id: ReasoningEffortId('off'), name: 'Off' },
          { id: ReasoningEffortId('high'), name: 'High' },
        ],
      },
    })
  })

  it('offers no reasoning control when the record and the transport share no level', async () => {
    const server = await mockServer([{ events: textEvents }])
    const adapter = adapterOf(gateway(`${server.url}/v1`, {
      id: 'acme-think',
      contextWindow: 65_536,
      reasoningEfforts: { off: null, high: 'ultra' },
    }), () => generation({
      'acme-gateway/acme-think': {
        canonicalId: 'zhipuai/glm-5.3-flash',
        reasoning: true,
        reasoningEfforts: ['medium', 'max'],
      },
    }))

    // The transport encodes off/high and the record accepts medium/max, so the
    // intersection is empty. The model reports no reasoning control rather than
    // a list the runtime would reject or a level this route cannot send.
    const described = await adapter.resolveModel('acme-gateway', 'acme-think')
    expect(described.reasoning).toBeUndefined()
  })

  it('uses the shared modalities instead of a text-only route fallback', async () => {
    const server = await mockServer([{ events: textEvents }])
    const adapter = adapterOf(gateway(`${server.url}/v1`, {
      id: 'acme-text',
      contextWindow: 65_536,
      input: ['text'],
    }), () => generation({
      'acme-gateway/acme-text': { canonicalId: 'zhipuai/glm-5.3-flash', inputModalities: ['image'] },
    }))

    // A route's text-only fallback must not hide a modality the accepted
    // model record declares for this exact model.
    await expect(adapter.resolveModel('acme-gateway', 'acme-text')).resolves.toMatchObject({
      inputModalities: ['image'],
      context: { contextWindow: 65_536 },
    })
  })

  it('materializes shared effort and capacity facts for a custom route', async () => {
    const server = await mockServer([
      { events: textEvents }, { events: textEvents }, { events: textEvents },
    ])
    const adapter = adapterOf({
      'acme-gateway': {
        apiKeyEnv: 'PI_TEST_KEY',
        api: 'openai-completions',
        baseURL: `${server.url}/v1`,
        compat: { supportsReasoningEffort: true },
        models: [{ id: 'acme-dynamic', contextWindow: 65_536, maxTokens: 4_096 }],
      },
    }, () => generation({
      'acme-gateway/acme-dynamic': {
        canonicalId: 'zhipuai/glm-5.3-flash',
        inputModalities: ['text', 'image'],
        contextWindow: 131_072,
        maxOutputTokens: 2_048,
        reasoning: true,
        reasoningEfforts: ['none', 'low', 'high', 'xhigh', 'max'],
      },
    }))

    await expect(adapter.resolveModel('acme-gateway', 'acme-dynamic')).resolves.toMatchObject({
      inputModalities: ['text', 'image'],
      context: { contextWindow: 131_072 },
      reasoning: {
        efforts: [
          { id: ReasoningEffortId('off') },
          { id: ReasoningEffortId('low') },
          { id: ReasoningEffortId('high') },
          { id: ReasoningEffortId('xhigh') },
          { id: ReasoningEffortId('max') },
        ],
      },
    })

    for (const effort of ['off', 'xhigh', 'max']) {
      await firstChunk({
        provider: 'acme-gateway', model: 'acme-dynamic', messages: [],
        reasoningEffort: ReasoningEffortId(effort),
      }, adapter)
    }
    const requests = requestsOf(server)
    expect(requests.map(request => request['reasoning_effort'])).toEqual(['none', 'xhigh', 'max'])
    expect(requests.map(request => request['max_completion_tokens'])).toEqual([2_048, 2_048, 2_048])
  })

  it('bounds a request by the shared output ceiling without making one a default', async () => {
    const server = await mockServer([{ events: textEvents }])
    const adapter = adapterOf(gateway(`${server.url}/v1`, {
      id: 'acme-plain',
      contextWindow: 65_536,
      maxTokens: 4_096,
    }), () => generation({
      'acme-gateway/acme-plain': { canonicalId: 'zhipuai/glm-5.3-flash', maxOutputTokens: 512 },
    }))

    // The ceiling sizes the model; the cap the deployment configured is still
    // the cap a request that names none carries.
    await expect(adapter.resolveModel('acme-gateway', 'acme-plain')).resolves.toMatchObject({
      defaultMaxTokens: 4_096,
    })
    await expect(firstChunk({
      provider: 'acme-gateway', model: 'acme-plain', messages: [], maxTokens: 1_024,
    }, adapter)).rejects.toThrow(/produces at most 512 output tokens/)

    // A request at the ceiling is one the model could answer, so it is sent.
    const prepared = await adapter.prepareCall('acme-gateway', 'acme-plain')
    const chunks = []
    for await (const chunk of prepared.stream({
      provider: 'acme-gateway', model: 'acme-plain', messages: [], maxTokens: 512,
    })) {
      chunks.push(chunk)
    }
    expect(chunks.some(chunk => chunk.type === 'text-delta')).toBe(true)
    expect(server.requests[0]).toMatchObject({ max_completion_tokens: 512 })
  })

  it('describes and encodes one operation from one generation', async () => {
    const published: { current?: ModelFactsView } = {
      current: generation({
        'deepseek/deepseek-v4-flash': { canonicalId: 'deepseek/deepseek-v4-flash', contextWindow: 4_096 },
      }, 1),
    }
    const server = await mockServer([])
    const adapter = adapterOf(catalogRoute(server.url), () => published.current)
    const prepared = await adapter.prepareCall('deepseek', 'deepseek-v4-flash')

    // A refresh between describing a model and encoding against it leaves the
    // call that started under the older generation on that generation, and
    // gives the next one the newer facts.
    published.current = generation({
      'deepseek/deepseek-v4-flash': { canonicalId: 'deepseek/deepseek-v4-flash', contextWindow: 8_192 },
    }, 2)
    expect(prepared.model.context?.contextWindow).toBe(4_096)
    await expect(adapter.resolveModel('deepseek', 'deepseek-v4-flash')).resolves.toMatchObject({
      context: { contextWindow: 8_192 },
    })
  })
})
