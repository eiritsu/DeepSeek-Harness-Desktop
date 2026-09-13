/** Browser Settings contribution for credential-gated external tools. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { ExternalToolsTab } from './ExternalToolsTab.tsx'
import { ExternalToolsController } from './controller.ts'
export type { ExternalToolsFace, ExternalToolsSnapshot, ExternalToolRow } from './controller.ts'
export { ExternalToolsTab } from './ExternalToolsTab.tsx'
export const inject = ['slots', 'locale', 'remote', 'remote.credentials', 'settingsScope']
export function apply(ctx: Context): void {
  const controller = new ExternalToolsController(ctx, ctx.settingsScope.bind({ namespace: 'external-tools' }))
  const t = ctx.locale.bind('settings.plugins')
  ctx.effect(() => { const off = ctx.remote.$on('credentials/reference-updated', () => { void controller.refresh() }); return off }, 'external-tools-ui: credential refresh')
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({ name: 'settings.plugins.tab', id: 'tools', order: 20, label: () => t('externalToolsTab'), locale: 'settings.plugins', inject: () => controller.inject() }, ExternalToolsTab))
}
