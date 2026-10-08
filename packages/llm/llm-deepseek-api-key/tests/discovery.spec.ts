/** Official DeepSeek models are selectable only while the route has a usable key. */
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { createLaunchEnvironmentSnapshot, DSH_LAUNCH_ENVIRONMENT_KEY } from '@deepseek-ai/dsh-launch-environment'
import { expect, it } from 'vitest'
import * as ApiKey from '../src/index.ts'

it('omits models without a key and reflects credentials added or removed at runtime', async () => {
  let key: string | undefined
  const ctx = new Context()
  ctx.provide('credentials', {
    resolve: async () => key === undefined ? undefined : { value: key, source: 'fixture' },
  } as never)
  try {
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(ApiKey, {})

    await expect(ctx.llm.listModels('deepseek-official')).resolves.toEqual([])

    key = 'fixture-key'
    await expect(ctx.llm.listModels('deepseek-official')).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'deepseek-official', id: 'deepseek-flash' }),
    ]))

    key = undefined
    await expect(ctx.llm.listModels('deepseek-official')).resolves.toEqual([])
  } finally {
    await ctx.fiber.dispose()
  }
})

it('uses a valid launch-environment key for discovery', async () => {
  const ctx = new Context()
  ctx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot([{
    source: 'process', values: { DEEPSEEK_API_KEY: 'environment-key' },
  }]))
  try {
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(ApiKey, {})
    expect(await ctx.llm.listModels('deepseek-official')).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'deepseek-official', id: 'deepseek-flash' }),
    ]))
  } finally {
    await ctx.fiber.dispose()
  }
})

it('keeps invalid configured credentials explicit during discovery', async () => {
  const ctx = new Context()
  ctx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot([{
    source: 'process', values: { DEEPSEEK_API_KEY: 'invalid\nheader' },
  }]))
  try {
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(ApiKey, {})
    await expect(ctx.llm.listModels('deepseek-official')).rejects.toMatchObject({ code: 'INVALID_CREDENTIAL' })
  } finally {
    await ctx.fiber.dispose()
  }
})
