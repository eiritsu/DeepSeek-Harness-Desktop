/**
 * Model-facing sidebar_open and browser_open tools for controlling the GUI right sidebar and built-in browser.
 *
 * @module @deepseek-ai/dsh-tool-sidebar
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import '@deepseek-ai/dsh-system-prompt'

/** Plugin configuration for tool-sidebar. */
export interface Config {}

export const Config: z<Config> = z.object({})

export const name = 'tool-sidebar'
export const inject = ['tools', 'systemPrompt']

const SIDEBAR_PROMPT =
  'You have access to GUI right sidebar controls via `sidebar_open` and `browser_open`:\n'
  + '- Built-in Web Browser: Call `browser_open(url="https://...")` or `sidebar_open(tab="browser", target="https://...")` to open and navigate the built-in browser tab in the right sidebar for the user to view web pages.\n'
  + '- Workspace Files: Call `sidebar_open(tab="files", target="path/to/file")` to open and reveal workspace files or directories in the sidebar file tree/preview.\n'
  + '- Terminal: Call `sidebar_open(tab="terminal")` to switch the right sidebar to the interactive persistent terminal.\n'
  + '- Session Inspector: Call `sidebar_open(tab="session-inspector")` to switch the right sidebar to the session diagnostics and raw event log inspector.\n'
  + '- Other Sidebar Panels: Call `sidebar_open(tab="<panel-id>", target="<resource-uri>")` to open and display interactive plugin panels or sidecars in the right sidebar.'

/** Supported sidebar tab identifiers. */
export type SidebarTab = 'browser' | 'files' | 'terminal' | 'session-inspector' | (string & {})

/** Tool input arguments for sidebar_open. */
export interface SidebarOpenArgs {
  tab: string
  target?: string
}

/** Tool output result for sidebar_open. */
export interface SidebarOpenResult {
  success: boolean
  tab: string
  target?: string
  message: string
}

/** Tool input arguments for browser_open. */
export interface BrowserOpenArgs {
  url: string
}

/** Tool output result for browser_open. */
export interface BrowserOpenResult {
  success: boolean
  url: string
  message: string
}

/**
 * Register sidebar_open and browser_open tools and the system prompt section into the agent context.
 *
 * @param ctx - Cordis context containing tools and systemPrompt services.
 */
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'tool:sidebar',
    order: 350,
    text: SIDEBAR_PROMPT,
  })

  ctx.tools.register(defineTool({
    name: 'sidebar_open',
    description: 'Open or switch to a right sidebar tab to present it to the user. Supported tabs: "browser" (built-in web browser, target=URL), "files" (workspace files tree or file preview, target=path), "terminal" (interactive terminal), "session-inspector" (session diagnostic log), or any registered sidebar panel/viewer.',
    parameters: {
      tab: {
        type: 'string',
        required: true,
        description: 'The sidebar tab or panel to open or reveal. Supported values: "browser", "files", "terminal", "session-inspector", or any registered sidebar panel ID.',
      },
      target: {
        type: 'string',
        description: 'Optional URL (for browser tab) or workspace-relative path (for files tab).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          success: { type: 'boolean', required: true },
          tab: { type: 'string', required: true },
          target: { type: 'string' },
          message: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    execute(args) {
      const tab = args.tab
      const target = args.target
      const message = target !== undefined && target !== ''
        ? `Opened sidebar tab "${tab}" with target "${target}".`
        : `Opened sidebar tab "${tab}".`
      return Promise.resolve({
        success: true,
        tab,
        ...target !== undefined && target !== '' ? { target } : {},
        message,
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_open',
    description: 'Open and navigate the built-in sidebar browser in the GUI to a web page or URL.',
    parameters: {
      url: {
        type: 'string',
        required: true,
        description: 'The web URL to open and display in the right sidebar browser (e.g. "https://example.com" or "http://localhost:3000").',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          success: { type: 'boolean', required: true },
          url: { type: 'string', required: true },
          message: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    execute(args) {
      const url = args.url
      return Promise.resolve({
        success: true,
        url,
        message: `Opened sidebar browser at "${url}".`,
      })
    },
  }))
}
