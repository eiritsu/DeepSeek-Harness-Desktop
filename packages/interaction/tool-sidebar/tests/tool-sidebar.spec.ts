import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Tools from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as ToolSidebar from '../src/index.ts'

describe('tool-sidebar', () => {
  it('registers sidebar_open and browser_open tools and system prompt section', async () => {
    const ctx = new Context()
    await ctx.plugin(Tools)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolSidebar)

    const sidebarTool = ctx.tools.get('sidebar_open')
    expect(sidebarTool).toBeDefined()
    expect(sidebarTool?.name).toBe('sidebar_open')

    const browserTool = ctx.tools.get('browser_open')
    expect(browserTool).toBeDefined()
    expect(browserTool?.name).toBe('browser_open')

    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.some(s => s.name === 'tool:sidebar')).toBe(true)

    const res1 = await sidebarTool?.execute({ tab: 'browser', target: 'https://deepseek.com' }, {} as never)
    expect(res1).toEqual({
      success: true,
      tab: 'browser',
      target: 'https://deepseek.com',
      message: 'Opened sidebar tab "browser" with target "https://deepseek.com".',
    })

    const res2 = await sidebarTool?.execute({ tab: 'terminal' }, {} as never)
    expect(res2).toEqual({
      success: true,
      tab: 'terminal',
      message: 'Opened sidebar tab "terminal".',
    })

    const res3 = await browserTool?.execute({ url: 'https://example.com' }, {} as never)
    expect(res3).toEqual({
      success: true,
      url: 'https://example.com',
      message: 'Opened sidebar browser at "https://example.com".',
    })
  })
})
