/**
 * Model-facing sidebar control tool.
 * Registers `sidebar_open` so the agent can open right sidebar tabs:
 * session inspector / raw log, files viewer, terminal, or browser.
 *
 * @module @deepseek-ai/dsh-client-ui-sidebar-right/tool
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type GenericCallView } from '@deepseek-ai/dsh-tools'

export const name = 'tool-sidebar'
export const inject = ['tools']

export interface SidebarOpenArgs {
  tab: 'session-inspector' | 'files' | 'terminal' | 'browser'
  target?: string
}

export interface SidebarOpenResult {
  success: boolean
  tab: string
  target?: string
  message: string
}

const description = 'Open or switch to a right sidebar tab to present it to the user. Supported tabs: "session-inspector" (session raw events and diagnostics), "files" (workspace files or a specific file), "terminal" (interactive shell), "browser" (web page).'

/**
 * Register the `sidebar_open` tool with the tool runtime.
 * @param ctx - Context containing `ctx.tools`.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'sidebar_open',
    description,
    parameters: {
      tab: {
        type: 'string',
        enum: ['session-inspector', 'files', 'terminal', 'browser'],
        required: true,
        description: 'The sidebar tab to open: "session-inspector" (session raw events and diagnostics), "files" (workspace file tree or file viewer), "terminal" (interactive shell), or "browser" (web browser).',
      },
      target: {
        type: 'string',
        description: 'Optional target for the tab: a relative/absolute path for "files" to view a specific file; or a URL (http:// or https://) for "browser".',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          success: { type: 'boolean', required: true },
          tab: { type: 'string', required: true },
          target: { type: 'string' },
          message: { type: 'string', required: true },
        },
      },
      render: (_args, value) => {
        const val = value as SidebarOpenResult
        return [{ type: 'text', text: val.message }]
      },
    },
    presentCall(rawArgs): GenericCallView {
      const args = rawArgs as Partial<SidebarOpenArgs> | undefined
      const targetStr = args?.target ? ` (${args.target})` : ''
      return {
        card: 'generic',
        title: `Open Sidebar: ${args?.tab ?? 'tab'}${targetStr}`,
      }
    },
    async execute(args): Promise<SidebarOpenResult> {
      const tab = args.tab
      const target = args.target
      let message = `Opened sidebar tab "${tab}".`
      if (target) {
        message = `Opened sidebar tab "${tab}" with target "${target}".`
      }
      return {
        success: true,
        tab,
        ...target ? { target } : {},
        message,
      }
    },
  }))
}
