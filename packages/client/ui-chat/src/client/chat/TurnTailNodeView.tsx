import { memo } from 'react'
import { IconRefreshOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { AssistantMessageNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionInterruptedRetryTarget } from '@deepseek-ai/dsh-api-remotes/client'
import type { ChatNodeViewProps, TurnTailOwnerProps } from '../contract/slots.ts'
import { MessageIconActions } from './MessageIconActions.tsx'
import { sameRetryTarget } from './retry-interrupted.ts'
import { TurnTimePanel, TurnUsagePanel } from './TurnUsagePanel.tsx'
import { assistantText } from './turn-assistant.ts'
import css from './TurnTailNodeView.module.css'

type TurnTailNodeViewProps = ChatNodeViewProps<'turn-tail'>
  & PropsRenderSlots<'conversation.chat.turnTail' | 'conversation.chat.assistant-actions'>

/** Durable address a Turn's closing interrupted answer can be regenerated from. */
function retryTargetOf(finalNode: AssistantMessageNode): SessionInterruptedRetryTarget | undefined {
  if (finalNode.messageId !== undefined) {
    return { kind: 'assistant-message', messageId: finalNode.messageId }
  }
  if (finalNode.attemptSeq !== undefined) {
    return { kind: 'assistant-attempt', seq: finalNode.attemptSeq }
  }
  return undefined
}

/** Turn-local actions and feature tail over the Location index, independent of Assistant placement. */
export const TurnTailNodeView = memo(function TurnTailNodeView({
  node, openFile, forkAt, renderSlot, renderSlotChain, t, useChat, retryInterrupted,
}: TurnTailNodeViewProps) {
  const data = node.data
  const hasLaterChatNode = useChat(snapshot =>
    snapshot.locations.getTurn(data.turn).at(-1) !== node.key)
  const isLatestTurn = useChat(snapshot => snapshot.timeline.turnOrder.at(-1) === data.turn)
  const turn = node.location.kind === 'turn' || node.location.kind === 'step'
    ? node.location.turn
    : undefined
  if (turn === undefined) return null
  const closing = data.closing
  const owner: TurnTailOwnerProps = { turn, seq: closing?.finalNode.seq ?? data.seq, openFile }
  const tail = renderSlotChain('conversation.chat.turnTail', owner)
  if (closing === null) return tail === null ? null : <div className={css.root}>{tail}</div>
  const runMs = turn.start === undefined || turn.end === undefined
    ? undefined
    : Math.max(0, turn.end.time - turn.start.time)
  // Interruption-frozen partials carry no messageId, so they address no
  // durable message and contribute no per-message actions. A log-only attempt
  // still carries its durable seq, which the retry action addresses.
  const messageId = closing.finalNode.messageId
  const assistantActions = messageId === undefined
    ? null
    : renderSlot('conversation.chat.assistant-actions', { messageId })
  const retryTarget = retryTargetOf(closing.finalNode)
  const retryState = retryInterrupted.state
  const retryError = retryState.error
  const retryFailed = retryError !== null
    && retryTarget !== undefined
    && sameRetryTarget(retryError.target, retryTarget)
  const retryAction = retryTarget !== undefined
    && data.retryable
    && isLatestTurn
    && !retryInterrupted.sessionRunning
    ? (
      <>
        <Tooltip label={t('message.retryInterrupted.action')} side="bottom">
          <button
            type="button"
            className={css.retryAction}
            aria-label={t('message.retryInterrupted.action')}
            disabled={retryState.pending}
            onClick={() => { retryInterrupted.run(retryTarget) }}
          >
            <IconRefreshOutline16 />
          </button>
        </Tooltip>
        {retryFailed && (
          <span className={css.retryFailure} role="status">
            {retryError.code === 'session/retry-unavailable'
              ? t('message.retryInterrupted.unavailable')
              : t('message.retryInterrupted.failed')}
          </span>
        )}
      </>
    )
    : null
  return (
    <div
      className={css.root}
      data-turn-tail={data.turn}
      data-actions-reveal={isLatestTurn ? 'always' : 'hover'}
    >
      {tail}
      <MessageIconActions
        text={assistantText(closing.blocks)}
        time={closing.time}
        clock="end"
        onBranch={() => { forkAt(closing.finalNode.seq) }}
        branchUnavailable={data.branchUnavailable || hasLaterChatNode}
        className={css.actions}
        retryAction={retryAction}
        extraActions={assistantActions}
        usageAction={(
          <>
            {data.tokenUsage !== undefined && <TurnUsagePanel usage={data.tokenUsage} t={t} />}
            {runMs !== undefined && (
              <TurnTimePanel
                runMs={runMs}
                tokensPerSecond={data.tokensPerSecond}
                ttftMs={data.ttftMs}
                t={t}
              />
            )}
          </>
        )}
        t={t}
      />
    </div>
  )
})
