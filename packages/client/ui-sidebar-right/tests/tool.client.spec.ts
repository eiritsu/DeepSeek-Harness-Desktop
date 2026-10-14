import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ToolSidebar from '../src/tool.ts'

describe('sidebar_open tool', () => {
  it('registers sidebar_open with expected schema and presentation', async () => {
    const ctx = new Context()
    ctx.provide('systemPrompt', {
      tools: vi.fn(() => () => {}),
      section: vi.fn(() => () => {}),
    } as never)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(ToolSidebar)

    const tool = ctx.tools.get('sidebar_open')
    expect(tool).toBeDefined()
    expect(tool?.name).toBe('sidebar_open')
    expect(tool?.parameters).toMatchObject({
      type: 'object',
      properties: {
        tab: {
          type: 'string',
          enum: ['session-inspector', 'files', 'terminal', 'browser'],
        },
        target: {
          type: 'string',
        },
      },
      required: ['tab'],
    })

    const viewWithoutTarget = tool?.presentCall?.({ tab: 'session-inspector' })
    expect(viewWithoutTarget).toEqual({
      card: 'generic',
      title: 'Open Sidebar: session-inspector',
    })

    const viewWithTarget = tool?.presentCall?.({ tab: 'files', target: 'src/main.ts' })
    expect(viewWithTarget).toEqual({
      card: 'generic',
      title: 'Open Sidebar: files (src/main.ts)',
    })
  })

  it('executes and renders output correctly', async () => {
    const ctx = new Context()
    ctx.provide('systemPrompt', {
      tools: vi.fn(() => () => {}),
      section: vi.fn(() => () => {}),
    } as never)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(ToolSidebar)

    const tool = ctx.tools.get('sidebar_open')
    expect(tool).toBeDefined()

    const resultWithoutTarget = await tool!.execute({ tab: 'terminal' }, { signal: new AbortController().signal } as never)
    expect(resultWithoutTarget).toEqual({
      success: true,
      tab: 'terminal',
      message: 'Opened sidebar tab "terminal".',
    })

    const rendered1 = tool!.output.render({ tab: 'terminal' }, resultWithoutTarget as never)
    expect(rendered1).toEqual([{ type: 'text', text: 'Opened sidebar tab "terminal".' }])

    const resultWithTarget = await tool!.execute({ tab: 'browser', target: 'https://example.com' }, { signal: new AbortController().signal } as never)
    expect(resultWithTarget).toEqual({
      success: true,
      tab: 'browser',
      target: 'https://example.com',
      message: 'Opened sidebar tab "browser" with target "https://example.com".',
    })

    const rendered2 = tool!.output.render({ tab: 'browser', target: 'https://example.com' }, resultWithTarget as never)
    expect(rendered2).toEqual([{ type: 'text', text: 'Opened sidebar tab "browser" with target "https://example.com".' }])
  })
})
