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
  return { deepseek: { baseURL } }
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

/** Drive one prepared call far enough to reach the refusal it makes. */
async function firstChunk(options: GenerateOptions, adapter: PiAiAdapter): Promise<unknown> {
  const prepared = await adapter.prepareCall(options.provider ?? '', options.model)
  return prepared.stream(options)[Symbol.asyncIterator]().next()
}

describe('shared model facts', () => {
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
      inputModalities: ['text'],
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

  it('keeps the transport modalities when the record shares none of them', async () => {
    const server = await mockServer([{ events: textEvents }])
    const adapter = adapterOf(gateway(`${server.url}/v1`, {
      id: 'acme-text',
      contextWindow: 65_536,
      input: ['text'],
    }), () => generation({
      'acme-gateway/acme-text': { canonicalId: 'zhipuai/glm-5.3-flash', inputModalities: ['image'] },
    }))

    // A record with no modality this route can carry says nothing usable about
    // it, so the transport's own list stands rather than describing a model
    // that takes only images the request path refuses.
    await expect(adapter.resolveModel('acme-gateway', 'acme-text')).resolves.toMatchObject({
      inputModalities: ['text'],
      context: { contextWindow: 65_536 },
    })
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
