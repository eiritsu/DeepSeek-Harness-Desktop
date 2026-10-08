/** Test-only selection driver that chooses a live catalog toggle. */

import { installModelSelection } from '@deepseek-ai/dsh-agent'

const SELECTED = { provider: 'minimax-cn-custom', model: 'MiniMax-M3' }
const selections = new WeakMap()

export const name = 'model-switch-driver'
export const inject = ['agents', 'llm', 'modelCatalog']

/**
 * Install the real selection helper and change its input after `todo_write`.
 * @param {import('@deepseek-ai/cordis').Context} ctx - composition context.
 */
export function apply(ctx) {
  ctx.on('agent/created', ({ agent }) => {
    const selection = { current: undefined, assembled: undefined }
    selections.set(agent.session, selection)
    installModelSelection(agent.ctx, selection)
  })
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'todo/write') return
    const selection = selections.get(session)
    if (selection === undefined) throw new Error('model-switch driver requires an installed selection')
    selection.current = SELECTED
  })
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next()
    if (context.agent === undefined) return assembled
    const selected = selections.get(context.agent.session)?.assembled
    if (selected === undefined) return assembled
    return {
      ...assembled,
      variables: { ...assembled.variables, provider: selected.provider, model: selected.model },
    }
  })
  ctx.on('agent/request', async ({ agent }, next) => {
    const resolved = await next()
    const selected = selections.get(agent.session)?.assembled
    if (selected === undefined) return resolved

    await ctx.modelCatalog.refresh()
    const emptyModel = await ctx.llm.resolveModelInfo('minimax-cn-custom', 'MiniMax-M2.7-highspeed')
    if (emptyModel.reasoning !== undefined) {
      throw new Error('model-switch driver received selectable controls for MiniMax M2.7 highspeed')
    }
    const selectedModel = await ctx.llm.resolveModelInfo(selected.provider, selected.model)
    const advertised = selectedModel.reasoning?.control === 'toggle'
      ? 'on'
      : selectedModel.reasoning?.efforts.at(-1)?.id
    if (advertised === undefined) {
      throw new Error(`model-switch driver found no reasoning control for ${selected.provider}/${selected.model}`)
    }
    const { reasoningEffort: _inheritedEffort, ...withoutInheritedEffort } = resolved
    return {
      ...withoutInheritedEffort,
      ...selected,
      reasoningEffort: advertised,
    }
  })
}
