import { Fragment, memo, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { PendingSubmission } from '@deepseek-ai/dsh-api-session-controller/client'
import type { MessageImageSource } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { Button, fileExtension, FileTypeIcon, fileSizeText, JsonBlock, projectUserText, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatNode } from '../contract/chat-nodes.ts'
import type { ChatNodeOwnerProps, ChatNodeViewProps, ChatViewSlotProps } from '../contract/slots.ts'
import type { ModelRetryNode, TurnErrorNode, UserMessageNode } from '../contract/snapshot.ts'
import { CompactionItem } from './CompactionItem.tsx'
import { ContextInjectionRow } from './ContextInjectionRow.tsx'
import { MessageIconActions } from './MessageIconActions.tsx'
import css from './MessageItem.module.css'

type UserImage = Extract<UserMessageNode['content'][number], { type: 'image' }>
type UserFile = Extract<UserMessageNode['content'][number], { type: 'file' }>
type PresentedAttachment =
  | { readonly type: 'image'; readonly image: MessageImageSource }
  | { readonly type: 'file'; readonly file: UserFile['attachment'] }

const RECOGNIZED_ATTACHMENT_PREFIX = '[DeepSeek Files extracted text from '
const RECOGNIZED_ATTACHMENT_TEXT_SEPARATOR = ':]\n'

function parseRecognizedAttachmentText(value: string): { readonly name: string; readonly text: string } | undefined {
  if (!value.startsWith(RECOGNIZED_ATTACHMENT_PREFIX)) return undefined
  const separator = value.indexOf(RECOGNIZED_ATTACHMENT_TEXT_SEPARATOR, RECOGNIZED_ATTACHMENT_PREFIX.length)
  if (separator < 0) return undefined
  let name: unknown
  try {
    name = JSON.parse(value.slice(RECOGNIZED_ATTACHMENT_PREFIX.length, separator))
  } catch {
    return undefined
  }
  if (typeof name !== 'string') return undefined
  return { name, text: value.slice(separator + RECOGNIZED_ATTACHMENT_TEXT_SEPARATOR.length) }
}

function contentParts(content: readonly unknown[]): {
  text: string
  recognized: Array<{ readonly name: string; readonly text: string }>
  attachments: PresentedAttachment[]
  rest: unknown[]
} {
  const texts: string[] = []
  const recognized: Array<{ readonly name: string; readonly text: string }> = []
  const attachments: PresentedAttachment[] = []
  const rest: unknown[] = []
  for (const block of content) {
    const b = block as { type?: string; text?: string; attachment?: unknown }
    if (b.type === 'text' && typeof b.text === 'string') {
      const extracted = parseRecognizedAttachmentText(b.text)
      if (extracted === undefined) texts.push(b.text)
      else recognized.push(extracted)
    }
    else if (b.type === 'image' && b.attachment !== undefined) {
      attachments.push({ type: 'image', image: { attachment: (b as UserImage).attachment } })
    }
    else if (b.type === 'file' && b.attachment !== undefined) {
      attachments.push({ type: 'file', file: (b as UserFile).attachment })
    }
    else rest.push(block)
  }
  return { text: texts.join(''), recognized, attachments, rest }
}

function retrySeconds(milliseconds: number): number {
  return Math.max(1, Math.ceil(milliseconds / 1_000))
}

interface RetryCountdown {
  deadline: number
  seconds: number
}

function failureMessage(
  message: string,
  code: unknown,
  t: ChatViewSlotProps['t'],
): string {
  return code === 'AUTH' ? t('message.failure.auth') : message
}

function ModelRetryItem({ node, active, t }: {
  node: ModelRetryNode
  active: boolean
  t: ChatViewSlotProps['t']
}) {
  // Anchor the host-scheduled delay to this browser's first render of the
  // retry node. Host event time and Date.now() may belong to different clocks.
  const deadline = useMemo(() => Date.now() + node.delayMs, [node.delayMs, node.seq])
  const scheduledSeconds = retrySeconds(node.delayMs)
  const maximum = node.mode === 'normal' ? node.maxRetries : '∞'
  const [countdown, setCountdown] = useState<RetryCountdown>(() => ({
    deadline,
    seconds: retrySeconds(deadline - Date.now()),
  }))
  const remainingSeconds = countdown.deadline === deadline
    ? countdown.seconds
    : retrySeconds(deadline - Date.now())

  useEffect(() => {
    if (!active) return
    const updateCountdown = (): number => {
      const next = retrySeconds(deadline - Date.now())
      setCountdown(current => (
        current.deadline === deadline && current.seconds === next
          ? current
          : { deadline, seconds: next }
      ))
      return next
    }
    if (updateCountdown() === 1) return
    const timer = window.setInterval(() => {
      if (updateCountdown() === 1) window.clearInterval(timer)
    }, 250)
    return () => { window.clearInterval(timer) }
  }, [active, deadline])

  const label = active
    ? t('message.retry.active')
    : node.retryState === 'cancelled'
      ? t('message.retry.cancelled')
      : node.retryState === 'started'
        ? t('message.retry.started')
        : t('message.retry.scheduled')
  const seconds = active ? remainingSeconds : scheduledSeconds

  return (
    <details className={css.retryRow} data-active={active || undefined}>
      <summary className={css.retrySummary}>
        <span className={css.retryText} role="status">
          {t('message.retry.status', { label, retry: node.retry, maximum, seconds })}
        </span>
      </summary>
      <div className={css.retryDetails}>
        <div>
          <span className={css.retryDetailLabel}>{t('message.retry.delay')}</span>
          {t('duration.milliseconds', { milliseconds: Math.round(node.delayMs) })}
        </div>
        <div>
          <span className={css.retryDetailLabel}>{t('message.retry.failure')}</span>
          {failureMessage(node.failure.message, node.failure.code, t)}
        </div>
      </div>
    </details>
  )
}

/** Persistent, turn-positioned feedback for a terminal failure. */
function TurnErrorItem({ node, t }: {
  node: TurnErrorNode
  t: ChatViewSlotProps['t']
}) {
  return (
    <div className={css.turnErrorRow} role="status">
      <StateDot state="error" className={css.turnErrorDot} />
      <div className={css.turnErrorCopy}>
        <span className={css.turnErrorTitle}>{t('message.turnError')}</span>
        <span className={css.turnErrorMessage}>{failureMessage(node.message, node.code, t)}</span>
      </div>
      {node.code !== undefined && <code className={css.turnErrorCode}>{node.code}</code>}
    </div>
  )
}

/** Persistent, turn-positioned notice for a turn ended at the output-token cap. */
function TurnMaxTokensItem({ t }: {
  t: ChatViewSlotProps['t']
}) {
  return (
    <div className={css.turnErrorRow} role="status">
      <StateDot state="warning" className={css.turnErrorDot} />
      <div className={css.turnErrorCopy}>
        <span className={css.maxTokensTitle}>{t('message.maxTokens')}</span>
        <span className={css.turnErrorMessage}>{t('message.maxTokens.hint')}</span>
      </div>
    </div>
  )
}

/** Right-aligned bubble shared by user and steering rows. */
function UserStyleBubble({
  content, renderMessageImages, actions, editor, pending = false, echo = false, referenceLabels = [], skillNames = [],
  previewAttachments, references, t,
}: {
  content: readonly unknown[]
  renderMessageImages: ChatNodeOwnerProps['renderMessageImages']
  /** Optional IconActions (or similar) below the bubble; receives the joined text. */
  actions?: (text: string) => ReactNode
  /** Optional inline editor row below the actions (edit-and-resend). */
  editor?: ReactNode
  /** Whether this is the Host-authoritative pre-admission steering projection. */
  pending?: boolean
  /** Whether this is a local submission echo (invisible marker; the echo renders exactly like its durable replacement). */
  echo?: boolean
  /** Exact session mention labels associated by the adjacent recall node. */
  referenceLabels?: readonly string[]
  /** Skill names the step's `skill-invocation` injections loaded for this message. */
  skillNames?: readonly string[]
  /** Local submission-echo attachments replacing the content-derived attachment sequence. */
  previewAttachments?: readonly PresentedAttachment[]
  references?: Pick<ChatNodeOwnerProps, 'openFile' | 'openSkill'>
  t: ChatViewSlotProps['t']
}): ReactNode {
  const { text, recognized, attachments: contentAttachments, rest } = contentParts(content)
  const attachments = previewAttachments ?? contentAttachments
  const compactImages = attachments.length > 1
  const truncated = (total: number): string => t('json.truncated', { total })
  const showBubble = text !== '' || rest.length > 0
  return (
    <div
      className={css.userRow}
      data-pending-steering={pending || undefined}
      data-submission-echo={echo || undefined}
    >
      <div className={css.userStack}>
        {attachments.length > 0 && (
          <div className={css.attachmentRow} data-message-attachments>
            {attachments.map((attachment, index) => attachment.type === 'image'
              ? (
                <Fragment key={`image:${index}`}>
                  {renderMessageImages({
                    images: [attachment.image],
                    align: 'end',
                    compact: compactImages,
                  })}
                </Fragment>
              )
              : (
                <span key={`file:${index}`} className={css.fileCard} title={attachment.file.name}>
                  <FileTypeIcon path={attachment.file.name} className={css.fileIcon} />
                  <span className={css.fileContent}>
                    <span className={css.fileName}>{attachment.file.name}</span>
                    <span className={css.fileMeta}>
                      {[fileExtension(attachment.file.name).toUpperCase().slice(0, 8), fileSizeText(attachment.file.bytes)]
                        .filter(Boolean).join(' ')}
                    </span>
                  </span>
                </span>
              ))}
          </div>
        )}
        {showBubble && <div className={css.bubble}>
          {projectUserText(text, referenceLabels, skillNames, 'skill', references)}
          {rest.map((block, i) => <JsonBlock key={i} label={t('message.extraBlock')} payload={block} truncatedLabel={truncated} />)}
        </div>}
        {recognized.map((item, index) => (
          <details key={`${item.name}:${index}`} className={css.recognizedText}>
            <summary className={css.recognizedSummary}>
              {t('message.attachmentExtracted', { name: item.name })}
            </summary>
            <div className={css.recognizedBody}>{item.text}</div>
          </details>
        ))}
        {referenceLabels.length > 0 && (
          <div className={css.referenceSummary}>
            {t('message.referenceSummary', { labels: referenceLabels.join(t('message.referenceSeparator')) })}
          </div>
        )}
      </div>
      {actions?.(text)}
      {editor}
    </div>
  )
}

/**
 * Render one Host-authoritative pending steering item with the same visual
 * language as its eventual durable transcript node.
 * @param props - Pending message content and conversation translator.
 * @returns the pending steering bubble.
 */
export function PendingSteeringBubble({ content, renderMessageImages, t }: {
  content: readonly unknown[]
  renderMessageImages: ChatNodeOwnerProps['renderMessageImages']
  t: ChatViewSlotProps['t']
}): ReactNode {
  return (
    <UserStyleBubble
      content={content}
      renderMessageImages={renderMessageImages}
      pending
      t={t}
      actions={text => (
        <MessageIconActions
          text={text}
          clock="start"
          className={css.actions}
          t={t}
        />
      )}
    />
  )
}

/**
 * Render one local transcript or steering submission echo with the same
 * visual language and surface marker as the Host occurrence that replaces
 * it: draft text plus object-URL previews, visible from the submit click
 * until the durable `user/message` or steering occurrence renders.
 * @param props - the session snapshot's pending submission and render seats.
 * @returns the echoed user bubble.
 */
export function PendingSubmissionBubble({ submission, renderMessageImages, t }: {
  submission: PendingSubmission
  renderMessageImages: ChatNodeOwnerProps['renderMessageImages']
  t: ChatViewSlotProps['t']
}): ReactNode {
  const content = useMemo(
    () => (submission.text === '' ? [] : [{ type: 'text', text: submission.text }]),
    [submission.text],
  )
  const previewAttachments = useMemo<readonly PresentedAttachment[]>(
    () => submission.attachments.map(attachment => attachment.type === 'image'
      ? {
        type: 'image',
        image: {
          preview: {
            url: attachment.value.previewUrl,
            ...(attachment.value.name === undefined ? {} : { name: attachment.value.name }),
            ...(attachment.value.width === undefined ? {} : { width: attachment.value.width }),
            ...(attachment.value.height === undefined ? {} : { height: attachment.value.height }),
          },
        },
      }
      : { type: 'file', file: attachment.value }),
    [submission.attachments],
  )
  return (
    <UserStyleBubble
      content={content}
      previewAttachments={previewAttachments}
      renderMessageImages={renderMessageImages}
      pending={submission.placement === 'steering'}
      echo
      t={t}
      actions={text => (
        <MessageIconActions
          text={text}
          time={submission.time}
          clock="start"
          className={css.actions}
          t={t}
        />
      )}
    />
  )
}

/** Minimal inline editor for an edit-and-resend of the opening user message. */
function ResendEditor({ value, pending, onChange, onSubmit, onCancel, t }: {
  value: string
  pending: boolean
  onChange: (value: string) => void
  onSubmit: () => void
  onCancel: () => void
  t: ChatViewSlotProps['t']
}): ReactNode {
  return (
    <form
      className={css.resendEditor}
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <textarea
        className={css.resendInput}
        value={value}
        rows={2}
        aria-label={t('message.resend.editorLabel')}
        onChange={(event) => { onChange(event.target.value) }}
      />
      <div className={css.resendActions}>
        <Button variant="outline" size="sm" onClick={onCancel}>{t('cancel')}</Button>
        <Button
          variant="primary"
          size="sm"
          type="submit"
          disabled={pending || value.trim() === ''}
        >
          {t('message.resend.submit')}
        </Button>
      </div>
    </form>
  )
}

/** User and admitted-steering keyed Chat renderer. */
export const UserMessageNodeView = memo(function UserMessageNodeView({
  node, renderMessageImages, openFile, openSkill, turnActions, useChat, t,
}: ChatNodeViewProps<'user' | 'steering'>) {
  const data = node.data
  // Only an ordinary turn-opening user message owns the latest Turn's
  // resendable prompt; a steering message belongs to an already-running Turn.
  // The tail is read through the Location index so the actions appear only on
  // the latest loaded Turn, and the selector returns the stable node so the
  // subscription never republishes a fresh object.
  const tail = useChat((snapshot): ChatNode<'turn-tail'> | undefined => {
    const location = node.location
    if (location.kind !== 'turn' && location.kind !== 'step') return undefined
    const turn = location.turn.turn
    if (snapshot.timeline.turnOrder.at(-1) !== turn) return undefined
    for (const key of snapshot.locations.getTurn(turn)) {
      const candidate = snapshot.nodes.get(key) as ChatNode | undefined
      if (candidate?.kind === 'turn-tail') return candidate
    }
    return undefined
  })
  const messageId = data.messageId
  const idle = !turnActions.sessionRunning
  const canResend = idle && node.kind === 'user' && messageId !== undefined && tail?.data.resendable === true
  const canResume = idle && node.kind === 'user' && tail?.data.resumable === true
  const failure = turnActions.state.error
  const admissionFailure = failure === null || (!canResend && !canResume)
    ? undefined
    : failure.action === 'resend'
      ? (failure.code === 'session/resend-unavailable'
        ? t('message.resend.unavailable')
        : t('message.resend.failed'))
      : (failure.code === 'session/resume-unavailable'
        ? t('message.resume.unavailable')
        : t('message.resume.failed'))
  const originalText = useMemo(
    () => (node.kind === 'user' ? contentParts(data.content).text : ''),
    [node.kind, data.content],
  )
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(originalText)
  const openEditor = (): void => {
    setDraft(originalText)
    setEditing(true)
  }
  const editor = editing && canResend
    ? (
      <ResendEditor
        value={draft}
        pending={turnActions.state.pending}
        onChange={setDraft}
        onSubmit={() => {
          if (messageId === undefined) return
          turnActions.resend(messageId, draft === originalText ? undefined : draft)
          setEditing(false)
        }}
        onCancel={() => { setEditing(false) }}
        t={t}
      />
    )
    : undefined
  return (
    <UserStyleBubble
      content={data.content}
      references={{ openFile, openSkill }}
      renderMessageImages={renderMessageImages}
      {...data.referenceLabels === undefined ? {} : { referenceLabels: data.referenceLabels }}
      {...data.skillNames === undefined ? {} : { skillNames: data.skillNames }}
      editor={editor}
      t={t}
      actions={text => (
        <MessageIconActions
          text={text}
          time={data.time}
          clock="start"
          className={css.actions}
          {...canResend ? { onResend: openEditor } : {}}
          {...canResume ? { onResume: () => { turnActions.resume() } } : {}}
          admissionPending={turnActions.state.pending}
          {...admissionFailure === undefined ? {} : { admissionFailure }}
          t={t}
        />
      )}
    />
  )
})

/** Injected-context keyed Chat renderer. */
export const ContextMessageNodeView = memo(function ContextMessageNodeView({ node, t }: ChatNodeViewProps<'context'>) {
  const data = node.data
  return (
    <ContextInjectionRow
      content={data.content}
      source={data.source}
      provenance={data.provenance}
      form={data.form}
      t={t}
    />
  )
})

/** Automatic compaction keyed Chat renderer. */
export const CompactionNodeView = memo(function CompactionNodeView({ node, t }: ChatNodeViewProps<'compaction'>) {
  return <CompactionItem node={node.data} t={t} />
})

/** Correlated retry-chain keyed Chat renderer. */
export const RetryNodeView = memo(function RetryNodeView({ node, t }: ChatNodeViewProps<'model-retry'>) {
  const data = node.data
  return <ModelRetryItem node={data.current} active={data.current.retryState === 'scheduled'} t={t} />
})

/** Terminal turn-error keyed Chat renderer. */
export const TurnErrorNodeView = memo(function TurnErrorNodeView({ node, t }: ChatNodeViewProps<'turn-error'>) {
  return <TurnErrorItem node={node.data} t={t} />
})

/** Max-tokens turn-end notice keyed Chat renderer. */
export const TurnMaxTokensNodeView = memo(function TurnMaxTokensNodeView({ t }: ChatNodeViewProps<'turn-max-tokens'>) {
  return <TurnMaxTokensItem t={t} />
})

/** Explicit unknown-surface keyed Chat renderer. */
export const UnknownNodeView = memo(function UnknownNodeView({ node, t }: ChatNodeViewProps<'unknown'>) {
  const data = node.data
  return (
    <div className={css.contextRow}>
      <JsonBlock
        label={t('message.unknownSurface', { type: data.type })}
        payload={data.data}
        truncatedLabel={total => t('json.truncated', { total })}
      />
    </div>
  )
})
