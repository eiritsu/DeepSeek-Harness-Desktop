/**
 * Resolution behavior of one catalog generation: what a bare id, a qualified
 * id, and a configured mapping each address, and what an ambiguous or absent
 * record refuses to answer.
 */

import { describe, expect, it } from 'vitest'
import { parseCatalogDocument } from '../src/parse.ts'
import { CatalogView, validateAliases } from '../src/resolve.ts'
import type { CatalogAlias } from '../src/resolve.ts'

const DOCUMENT = {
  models: {
    'zhipuai/glm-5.3-flash': {
      id: 'zhipuai/glm-5.3-flash',
      reasoning: true,
      modalities: { input: ['text', 'image', 'video'] },
      limit: { context: 1_000_000, output: 131_072 },
    },
    'openrouter/glm-5.3-flash': {
      id: 'openrouter/glm-5.3-flash',
      modalities: { input: ['text'] },
      limit: { context: 8_192 },
    },
    'zhipuai/plain-1': { id: 'zhipuai/plain-1', modalities: { input: ['text'] } },
  },
  providers: {
    zhipuai: {
      id: 'zhipuai',
      models: {
        'glm-5.3-flash': { reasoning_options: [{ type: 'effort', values: ['low', 'high', 'max'] }] },
      },
    },
    openrouter: {
      id: 'openrouter',
      models: { 'glm-5.3-flash': { reasoning: false } },
    },
  },
}

const ALIASED_DOCUMENT = {
  models: {
    'deepseek/deepseek-v4.1-flash': {
      id: 'deepseek/deepseek-v4.1-flash',
      reasoning: true,
      limit: { context: 1_000_000, output: 384_000 },
    },
  },
  providers: {
    chiyun: {
      id: 'chiyun',
      models: {
        'deepseek-flash': {
          canonical_model_id: 'deepseek/deepseek-v4.1-flash',
          reasoning: true,
          reasoning_options: [{ type: 'effort', values: ['low', 'high', 'max'] }],
        },
      },
    },
  },
}

function view(aliases: CatalogAlias[] = [], generation = 1): CatalogView {
  return new CatalogView(generation, parseCatalogDocument(DOCUMENT), aliases)
}

describe('catalog document parsing', () => {
  it('keeps the shared facts and drops modalities the harness cannot request', () => {
    const parsed = parseCatalogDocument(DOCUMENT)

    expect(parsed.canonical).toEqual([
      {
        id: 'zhipuai/glm-5.3-flash',
        input: ['text', 'image'],
        contextWindow: 1_000_000,
        maxOutputTokens: 131_072,
        reasoning: true,
      },
      { id: 'openrouter/glm-5.3-flash', input: ['text'], contextWindow: 8_192 },
      { id: 'zhipuai/plain-1', input: ['text'] },
    ])
  })

  it('skips records the document cannot address or says nothing about', () => {
    const parsed = parseCatalogDocument({
      models: {
        // The key is the identity: a record naming a different id is unreachable.
        'a/one': { id: 'b/one', modalities: { input: ['text'] } },
        // No owner, so neither an exact id nor a basename can address it.
        'bare': { id: 'bare', modalities: { input: ['text'] } },
        // A record with no fact at all is nothing to publish.
        'a/empty': { id: 'a/empty' },
        // Non-positive limits and a non-boolean declaration are not facts.
        'a/garbage': { id: 'a/garbage', limit: { context: 0, output: -1 }, reasoning: 'yes' },
        'a/kept': { id: 'a/kept', modalities: { input: ['text'] } },
      },
      providers: {},
    })

    expect(parsed.canonical).toEqual([{ id: 'a/kept', input: ['text'] }])
  })

  it('rejects a document that is not the catalog or carries no usable record', () => {
    expect(() => parseCatalogDocument({ models: {} })).toThrow(/models and providers objects/)
    expect(() => parseCatalogDocument({ models: [], providers: {} })).toThrow(/models and providers objects/)
    expect(() => parseCatalogDocument({ models: { 'a/b': { id: 'a/b' } }, providers: {} }))
      .toThrow(/no usable canonical model record/)
  })

  it('reads only effort options, and treats a denied reasoning record as accepting none', () => {
    const parsed = parseCatalogDocument({
      models: {
        'a/one': { id: 'a/one', reasoning: true },
        'a/two': { id: 'a/two', reasoning: false },
        'a/three': { id: 'a/three', reasoning: true },
        'a/four': { id: 'a/four', reasoning: true },
      },
      providers: {
        a: {
          models: {
            one: {
              reasoning_options: [
                { type: 'budget', values: [1000] },
                { type: 'effort', values: ['low', '', 'high'] },
              ],
            },
            // Denied by the channel itself: it accepts no level at all.
            two: { reasoning: false },
            // An effort option with no values declares nothing, so it is not
            // a vocabulary and the channel stays silent.
            three: { reasoning_options: [{ type: 'effort' }] },
            four: 'not an object',
          },
        },
      },
    })

    // Only declared effort values survive; a denied channel declares the empty
    // vocabulary; a channel with no effort option and a non-record entry
    // declare nothing at all.
    expect(parsed.channels).toEqual([
      { namespace: 'a', model: 'one', efforts: ['low', 'high'] },
      { namespace: 'a', model: 'two', efforts: [] },
    ])
  })

  it('keeps provider aliases attached to their canonical model identity', () => {
    expect(parseCatalogDocument(ALIASED_DOCUMENT).channels).toEqual([{
      namespace: 'chiyun',
      model: 'deepseek-flash',
      canonicalId: 'deepseek/deepseek-v4.1-flash',
      efforts: ['low', 'high', 'max'],
    }])
  })
})

describe('catalog view resolution', () => {
  it('answers a bare id only when one owner publishes it', () => {
    expect(view().facts({ model: 'plain-1' })).toEqual({
      canonicalId: 'zhipuai/plain-1',
      inputModalities: ['text'],
    })
    expect(view().facts({ model: 'glm-5.3-flash' })).toBeUndefined()
  })

  it('answers a qualified id exactly, case-insensitively', () => {
    expect(view().facts({ model: 'OpenRouter/GLM-5.3-Flash' })).toEqual({
      canonicalId: 'openrouter/glm-5.3-flash',
      inputModalities: ['text'],
      contextWindow: 8_192,
      reasoningEfforts: [],
    })
  })

  it('reports the channel vocabulary beside the shared facts', () => {
    expect(view().facts({ model: 'zhipuai/glm-5.3-flash' })).toEqual({
      canonicalId: 'zhipuai/glm-5.3-flash',
      inputModalities: ['text', 'image'],
      contextWindow: 1_000_000,
      maxOutputTokens: 131_072,
      reasoning: true,
      reasoningEfforts: ['low', 'high', 'max'],
    })
  })

  it('resolves efforts through a provider alias by canonical identity', () => {
    const aliased = new CatalogView(2, parseCatalogDocument(ALIASED_DOCUMENT), [])

    expect(aliased.facts({ model: 'deepseek-v4.1-flash', ownedBy: 'chiyun' })).toEqual({
      canonicalId: 'deepseek/deepseek-v4.1-flash',
      contextWindow: 1_000_000,
      maxOutputTokens: 384_000,
      reasoning: true,
      reasoningEfforts: ['low', 'high', 'max'],
    })
  })

  it('denies reasoning through every channel when the shared record denies it', () => {
    // The openrouter record says nothing about reasoning, and its channel
    // entry says the model does not reason at all.
    expect(view().facts({ model: 'openrouter/glm-5.3-flash' })?.reasoning).toBeUndefined()
    expect(view().facts({ model: 'openrouter/glm-5.3-flash' })?.reasoningEfforts).toEqual([])
  })

  it('prefers an owner-qualified mapping, then an unqualified one, then the id itself', () => {
    const aliases: CatalogAlias[] = [
      { modelId: 'plain-1', canonicalId: 'openrouter/glm-5.3-flash' },
      { ownedBy: 'zhipuai', modelId: 'plain-1', canonicalId: 'zhipuai/glm-5.3-flash' },
    ]

    expect(view(aliases).facts({ model: 'plain-1', ownedBy: 'zhipuai' })?.canonicalId)
      .toBe('zhipuai/glm-5.3-flash')
    expect(view(aliases).facts({ model: 'plain-1', ownedBy: 'other' })?.canonicalId)
      .toBe('openrouter/glm-5.3-flash')
    expect(view(aliases).facts({ model: 'plain-1' })?.canonicalId)
      .toBe('openrouter/glm-5.3-flash')
  })

  it('resolves nothing when mappings disagree or name a record this generation lacks', () => {
    expect(view([{ modelId: 'plain-1', canonicalId: 'x/y' }]).facts({ model: 'plain-1' })).toBeUndefined()
    expect(view([
      { ownedBy: 'a', modelId: 'plain-1', canonicalId: 'zhipuai/plain-1' },
      { ownedBy: 'a', modelId: 'plain-1', canonicalId: 'zhipuai/glm-5.3-flash' },
    ]).facts({ model: 'plain-1', ownedBy: 'a' })).toBeUndefined()
  })

  it('publishes the generation it was built under', () => {
    expect(view([], 7).generation).toBe(7)
  })
})

describe('mapping validation', () => {
  it('rejects an unusable mapping and two mappings claiming one id under one owner', () => {
    expect(() => { validateAliases([{ modelId: ' ', canonicalId: 'a/b' }]) }).toThrow(/qualified canonicalId/)
    expect(() => { validateAliases([{ modelId: 'x', canonicalId: 'ab' }]) }).toThrow(/qualified canonicalId/)
    expect(() => { validateAliases([{ modelId: 'x', ownedBy: ' ', canonicalId: 'a/b' }]) }).toThrow(/qualified canonicalId/)
    expect(() => {
      validateAliases([
        { modelId: 'x', canonicalId: 'a/b' },
        { modelId: 'X', canonicalId: 'c/d' },
      ])
    }).toThrow(/twice for the same owner scope/)
    expect(() => {
      validateAliases([
        { modelId: 'x', ownedBy: 'a', canonicalId: 'a/b' },
        { modelId: 'x', ownedBy: 'b', canonicalId: 'c/d' },
      ])
    }).not.toThrow()
  })
})
