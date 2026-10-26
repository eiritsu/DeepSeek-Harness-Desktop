/** Host-only folds used by edit-and-resend selection and idempotency reads. */

import { z } from 'zod'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import { MessageId } from '@deepseek-ai/dsh-llm/brand'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { ContentBlock, UserMessage } from '@deepseek-ai/dsh-llm'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import type { ImageAttachmentRef, FileAttachmentRef } from '@deepseek-ai/dsh-attachment/types'
import type { ResendJournalDraft, ResendJournalState, ResendPromptRecord, ResendTurnState } from './types.ts'

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  if (typeof value !== 'object') return false
  return Object.values(value).every(isJsonValue)
}

const safeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const attachmentIdSchema = z.string().min(1).transform(AttachmentId)
const imageAttachmentSchema = z.object({
  attachmentId: attachmentIdSchema,
  mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  bytes: safeInteger,
  width: safeInteger.min(1),
  height: safeInteger.min(1),
  name: z.string().optional(),
  originalDimensions: z.object({ width: safeInteger.min(1), height: safeInteger.min(1) }).strict().optional(),
}).strict() as z.ZodType<ImageAttachmentRef>
const fileAttachmentSchema = z.object({
  attachmentId: attachmentIdSchema,
  name: z.string(),
  bytes: safeInteger,
}).strict() as z.ZodType<FileAttachmentRef>
const knownContentTypes = new Set(['text', 'reasoning', 'image', 'file', 'tool-call', 'tool-addition', 'tool-removal'])
const contentBlockSchema: z.ZodType<ContentBlock> = z.lazy(() => z.union([
  z.object({ type: z.literal('text'), text: z.string() }).strict(),
  z.object({ type: z.literal('reasoning'), text: z.string() }).strict(),
  z.object({ type: z.literal('image'), attachment: imageAttachmentSchema, offloaded: z.literal(true).optional() }).strict(),
  z.object({ type: z.literal('file'), attachment: fileAttachmentSchema }).strict(),
  z.object({ type: z.literal('tool-call'), id: z.string().min(1).transform(ToolCallId), name: z.string(), arguments: z.string() }).strict(),
  z.object({ type: z.literal('tool-addition'), toolName: z.string(), tool: z.never().optional() }).strict(),
  z.object({ type: z.literal('tool-removal'), toolName: z.string() }).strict(),
  z.custom<ContentBlock>((value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
    const type = (value as { type?: unknown }).type
    return typeof type === 'string' && type.length > 0 && !knownContentTypes.has(type) && isJsonValue(value)
  }),
])) as z.ZodType<ContentBlock>
const userMessageSchema: z.ZodType<UserMessage> = z.object({
  id: z.string().min(1).transform(MessageId),
  role: z.literal('user'),
  content: z.array(contentBlockSchema),
  source: z.custom<UserMessage['source']>(value => typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && (value as { kind?: unknown }).kind === 'user'
    && isJsonValue(value)),
}).loose()

const promptRecordSchema = z.object({
  seq: z.number().int().nonnegative().transform(SessionSeq),
  turn: z.number().int().nonnegative(),
  message: userMessageSchema,
  toolCalls: z.array(z.string()).readonly(),
  endSeq: z.number().int().nonnegative().transform(SessionSeq).nullable(),
}).strict()

const turnStateSchema = z.object({
  latestStart: z.object({
    seq: z.number().int().nonnegative().transform(SessionSeq),
    turn: z.number().int().nonnegative(),
  }).strict().nullable(),
  latestEnd: z.object({
    seq: z.number().int().nonnegative().transform(SessionSeq),
    turn: z.number().int().nonnegative(),
    replaceable: z.boolean(),
  }).strict().nullable(),
  prompt: z.object({
    seq: z.number().int().nonnegative().transform(SessionSeq),
    message: userMessageSchema,
  }).strict().nullable(),
  toolCalls: z.array(z.string()).readonly(),
  prompts: z.array(promptRecordSchema).readonly().default([]),
}).strict()

const journalDraftSchema = z.object({
  operationId: z.string(),
  turn: z.number().int().nonnegative(),
  startSeq: z.number().int().nonnegative().transform(SessionSeq),
  endSeq: z.number().int().nonnegative().transform(SessionSeq),
  messageId: z.string().transform(MessageId).optional(),
  outcome: z.enum(['pending', 'uncertain', 'admitted', 'refused', 'failed']),
  refusal: z.enum([
    'no-replaceable-turn', 'not-latest-turn', 'no-human-prompt', 'no-editable-text',
    'agent-busy', 'inbox-pending', 'aborted',
  ]).optional(),
  reason: z.string().optional(),
}).strict()

const journalStateSchema = z.object({ drafts: z.array(journalDraftSchema).readonly() }).strict()

const EMPTY_TURN_STATE: ResendTurnState = {
  latestStart: null,
  latestEnd: null,
  prompt: null,
  toolCalls: [],
  prompts: [],
}

const EMPTY_JOURNAL_STATE: ResendJournalState = { drafts: [] }

/** Host projection of latest-turn prompt, ending, and tool-call facts. */
export const resendTurnProjectionDefinition = {
  key: 'resendTurn',
  stateVersion: 1,
  stateSchema: turnStateSchema,
  init: () => EMPTY_TURN_STATE,
  apply: (state, event) => {
    switch (event.type) {
      case 'turn/start':
        return {
          ...state,
          latestStart: { seq: event.seq, turn: event.data.turn },
          latestEnd: state.latestEnd,
          prompt: null,
          toolCalls: [],
        }
      case 'turn/end': {
        const turn = event.data.turn
        const updatedPrompts = state.prompts.map(p =>
          p.turn === turn ? { ...p, endSeq: event.seq } : p,
        )
        return {
          ...state,
          latestEnd: {
            seq: event.seq,
            turn,
            replaceable: true,
          },
          prompts: updatedPrompts,
        }
      }
      case 'user/message': {
        if (event.data.source.kind !== 'user') return state
        const turn = state.latestStart?.turn ?? 1
        const newRecord: ResendPromptRecord = {
          seq: event.seq,
          turn,
          message: event.data,
          toolCalls: [],
          endSeq: null,
        }
        const existingIdx = state.prompts.findIndex(p => p.seq === event.seq)
        const prompts = existingIdx >= 0
          ? state.prompts.toSpliced(existingIdx, 1, newRecord)
          : [...state.prompts, newRecord]

        const isLatestPrompt = state.latestStart !== null
          && state.prompt === null
          && event.seq > state.latestStart.seq
          && (state.latestEnd === null || state.latestEnd.seq <= state.latestStart.seq)

        return {
          ...state,
          prompt: isLatestPrompt ? { seq: event.seq, message: event.data } : state.prompt,
          prompts,
        }
      }
      case 'tool/call': {
        const turn = event.data.turn
        const toolName = event.data.name
        const prompts = state.prompts.map((p) => {
          if (p.turn !== turn || p.toolCalls.includes(toolName)) return p
          return { ...p, toolCalls: [...p.toolCalls, toolName] }
        })
        const updateLatest = state.latestStart !== null
          && turn === state.latestStart.turn
          && (state.latestEnd === null || state.latestEnd.seq <= state.latestStart.seq)
          && !state.toolCalls.includes(toolName)

        return {
          ...state,
          toolCalls: updateLatest ? [...state.toolCalls, toolName] : state.toolCalls,
          prompts,
        }
      }
      default:
        return state
    }
  },
} satisfies ProjectionDefinition<'resendTurn', ResendTurnState>

function replaceDraft(
  drafts: readonly ResendJournalDraft[],
  operationId: string,
  update: (draft: ResendJournalDraft | undefined) => ResendJournalDraft | undefined,
): readonly ResendJournalDraft[] {
  const index = drafts.findIndex(draft => draft.operationId === operationId)
  const next = update(index < 0 ? undefined : drafts[index])
  if (index < 0) return next === undefined ? drafts : [...drafts, next]
  if (next === undefined) return drafts.toSpliced(index, 1)
  return drafts.toSpliced(index, 1, next)
}

function admits(event: SessionEvent, draft: ResendJournalDraft): boolean {
  return event.type === 'user/message'
    && event.surfaceOp !== 'append'
    && event.surfaceOp.startSeq === draft.startSeq
    && event.surfaceOp.endSeq === draft.endSeq
}

/** Host projection of resend operation records and replacement admission proofs. */
export const resendJournalProjectionDefinition = {
  key: 'resendJournal',
  stateVersion: 1,
  stateSchema: journalStateSchema,
  init: () => EMPTY_JOURNAL_STATE,
  apply: (state, event) => {
    switch (event.type) {
      case 'turn-resend/requested':
        return {
          drafts: replaceDraft(state.drafts, event.data.operationId, () => ({
            operationId: event.data.operationId,
            turn: event.data.turn,
            startSeq: event.data.startSeq,
            endSeq: event.data.endSeq,
            outcome: 'pending',
          })),
        }
      case 'turn-resend/request-started':
        return {
          drafts: replaceDraft(state.drafts, event.data.operationId, draft => draft === undefined
            ? {
              operationId: event.data.operationId,
              turn: event.data.turn,
              startSeq: event.data.startSeq,
              endSeq: event.data.endSeq,
              messageId: event.data.messageId,
              outcome: 'uncertain',
            }
            : { ...draft, messageId: event.data.messageId, outcome: 'uncertain' }),
        }
      case 'turn-resend/settled':
        return {
          drafts: replaceDraft(state.drafts, event.data.operationId, (draft) => {
            if (draft === undefined) return undefined
            return event.data.outcome === 'refused'
              ? { ...draft, outcome: 'refused', refusal: event.data.refusal }
              : { ...draft, outcome: 'failed', reason: event.data.reason }
          }),
        }
      case 'user/message': {
        const matching = state.drafts.find(draft => draft.outcome === 'uncertain' && admits(event, draft))
        if (matching === undefined) return state
        return {
          drafts: replaceDraft(state.drafts, matching.operationId, draft => draft === undefined
            ? undefined
            : { ...draft, outcome: 'admitted' }),
        }
      }
      default:
        return state
    }
  },
} satisfies ProjectionDefinition<'resendJournal', ResendJournalState>
