/** Browser attachment plugin: fills conversation's composer and message-image slots. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { ComposerAttachments } from './ComposerAttachments.tsx'
import { MessageImages } from './MessageImages.tsx'
import { ATTACHMENT_PICKER_EVENT } from './events.ts'

/** Slot registry required by this presentation plugin. */
export const inject = ['slots', 'inputTriggers', 'locale']

/** Register attachment presentation without exporting React components as package values. */
export function apply(ctx: ClientContext): void {
  const translate = ctx.locale.bind('conversation')
  const source: InputTriggerSource = {
    trigger: '/',
    name: 'attachment',
    order: -100,
    launcherOnly: true,
    showGroupTitle: false,
    candidates: () => Promise.resolve([{
      name: translate('attachment.filesAndFolders'),
      section: translate('add.section'),
      icon: 'paperclip',
    }]),
    onPick: ({ session }) => {
      window.dispatchEvent(new CustomEvent(ATTACHMENT_PICKER_EVENT, {
        detail: { sessionId: String(session.sessionId) },
      }))
      return 'handled'
    },
  }
  ctx.effect(() => ctx.inputTriggers.registerSource(source), 'ui-attachment: Add launcher source')
  ctx.slots.inject('conversation.input.attachments', () => ctx.slots.register({
    name: 'conversation.input.attachments',
    locale: 'conversation',
  }, ComposerAttachments))
  ctx.slots.inject('conversation.message.images', () => ctx.slots.register({
    name: 'conversation.message.images',
    locale: 'conversation',
  }, MessageImages))
}
