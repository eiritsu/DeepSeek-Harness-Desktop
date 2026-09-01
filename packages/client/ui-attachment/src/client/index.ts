/** Browser attachment plugin: fills conversation's composer and message-image slots. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-trajectory/client'
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { InputTriggerCandidate, InputTriggerServiceContract, InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { ComposerAttachments } from './ComposerAttachments.tsx'
import { MessageImages } from './MessageImages.tsx'
import { ATTACHMENT_PICKER_EVENT } from './picker-event.ts'

/** Slot registry required by this presentation plugin. */
export const inject = ['slots', 'inputTriggers', 'locale']

/** Register attachment presentation without exporting React components as package values. */
export function apply(ctx: ClientContext): void {
  const inputTriggers = ctx.get('inputTriggers') as InputTriggerServiceContract | undefined
  const locale = ctx.get('locale')
  if (inputTriggers !== undefined && locale !== undefined) {
    const t = locale.bind('conversation')
    const source: InputTriggerSource = {
      trigger: '/',
      name: 'attachment',
      order: -100,
      candidates: async (_session, { signal }): Promise<readonly InputTriggerCandidate[]> => signal.aborted ? [] : [
        { name: t('attachment.filesAndFolders'), icon: 'paperclip', value: 'files' },
      ],
      onPick: ({ candidate }) => {
        if (candidate.value !== 'files') return undefined
        window.dispatchEvent(new CustomEvent(ATTACHMENT_PICKER_EVENT, { detail: { kind: candidate.value } }))
        return 'handled'
      },
    }
    ctx.effect(() => inputTriggers.registerSource(source), 'ui-attachment: plus-menu source')
  }
  ctx.slots.inject('conversation.input.attachments', () => ctx.slots.register({
    name: 'conversation.input.attachments',
    locale: 'conversation',
  }, ComposerAttachments))
  ctx.slots.inject('conversation.message.images', () => ctx.slots.register({
    name: 'conversation.message.images',
    locale: 'conversation',
  }, MessageImages))
  ctx.slots.inject('conversation.trajectory.images', () => ctx.slots.register({
    name: 'conversation.trajectory.images',
    locale: 'conversation',
  }, MessageImages))
}
