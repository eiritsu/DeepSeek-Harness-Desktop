/**
 * Selection of the one turn a resend may shadow, using incremental turn facts
 * and the current Session surface.
 *
 * @module @deepseek-ai/dsh-session-turn-edit-resend/policy
 */

import type { SurfaceReplacement } from '@deepseek-ai/dsh-agent'
import type { Session, SessionSeq, UserMessage } from '@deepseek-ai/dsh-session'
import type { ResendTurnState } from './types.ts'
import type { ResendRefusal } from './types.ts'

/** The one turn a resend may shadow. */
export interface ResendTarget {
  /** The direct human prompt whose content the caller edits. */
  readonly prompt: UserMessage
  /** Seq of the target turn's `turn/start`. */
  readonly turnStartSeq: SessionSeq
  /** Number of the target turn. */
  readonly turn: number
  /** Surface range the resent message takes the place of. */
  readonly replacement: SurfaceReplacement
  /** Distinct tools this turn called, in first-call order. */
  readonly toolCalls: readonly string[]
}

/** Either the one eligible target or the reason there is none. */
export type ResendSelection =
  | { readonly eligible: true; readonly target: ResendTarget }
  | { readonly eligible: false; readonly refusal: ResendRefusal }

function refuse(refusal: ResendRefusal): ResendSelection {
  return { eligible: false, refusal }
}

/**
 * Select the replaceable human prompt (specific target or latest), or the reason no turn is eligible.
 *
 * The current surface determines the replacement range. A prompt that an
 * earlier replacement removed is no longer eligible.
 * @param session - session whose current surface is read.
 * @param state - incrementally folded turn facts.
 * @param targetSeq - optional sequence of the specific human prompt to edit; defaults to latest.
 * @returns the eligible target, or the refusal that excludes it.
 */
export function selectResendTarget(
  session: Session,
  state: ResendTurnState,
  targetSeq?: SessionSeq,
): ResendSelection {
  let candidate: { seq: SessionSeq; turn: number; message: UserMessage } | undefined

  if (targetSeq !== undefined) {
    const fromPrompts = state.prompts.find(p => p.seq === targetSeq)
    if (fromPrompts !== undefined) {
      candidate = fromPrompts
    } else if (state.prompt !== null && state.prompt.seq === targetSeq) {
      candidate = { seq: state.prompt.seq, turn: state.latestStart?.turn ?? 1, message: state.prompt.message }
    } else {
      const ev = session.eventAt(targetSeq)
      if (ev?.type === 'user/message') {
        const msg = ev.data
        const sourceKind = (msg.source as { kind?: unknown }).kind
        if (sourceKind !== 'compact-checkpoint') {
          candidate = { seq: targetSeq, turn: state.latestStart?.turn ?? 1, message: msg }
        }
      }
    }
  } else {
    const surfacePrompts = state.prompts.filter(p => session.surface.nodes.includes(p.seq))
    if (surfacePrompts.length > 0) {
      candidate = surfacePrompts.at(-1)
    } else if (state.prompts.length > 0) {
      candidate = state.prompts.at(-1)
    } else if (state.prompt !== null) {
      candidate = { seq: state.prompt.seq, turn: state.latestStart?.turn ?? 1, message: state.prompt.message }
    } else {
      for (let s = session.seq - 1; s >= 0; s--) {
        const ev = session.eventAt(s as SessionSeq)
        if (ev?.type === 'user/message') {
          const msg = ev.data
          const sourceKind = (msg.source as { kind?: unknown }).kind
          if (sourceKind !== 'compact-checkpoint') {
            candidate = { seq: s as SessionSeq, turn: state.latestStart?.turn ?? 1, message: msg }
            break
          }
        }
      }
    }
  }

  if (candidate === undefined) return refuse('no-replaceable-turn')

  const surfaceNodes = session.surface.nodes
  const headSeq = surfaceNodes[0]
  const firstReplaceableIdx = (headSeq !== undefined && session.eventAt(headSeq)?.type === 'system/message')
    ? 1
    : 0
  const replaceableNodes = surfaceNodes.slice(firstReplaceableIdx)

  if (replaceableNodes.length === 0) return refuse('no-replaceable-turn')

  let range: readonly SessionSeq[]
  const candidateIdx = replaceableNodes.indexOf(candidate.seq)
  if (candidateIdx !== -1) {
    range = replaceableNodes.slice(candidateIdx)
  } else {
    let targetIdx = replaceableNodes.findIndex(seq => seq >= candidate.seq)
    if (targetIdx === -1) {
      targetIdx = Math.max(0, replaceableNodes.length - 1)
    }
    range = replaceableNodes.slice(targetIdx)
  }

  const startSeq = range[0]
  const endSeq = range.at(-1)
  if (startSeq === undefined || endSeq === undefined) return refuse('no-replaceable-turn')

  const toolCallsSet = new Set<string>()
  for (const p of state.prompts) {
    if (p.seq >= candidate.seq) {
      for (const tool of p.toolCalls) toolCallsSet.add(tool)
    }
  }
  if (candidate.seq === state.latestStart?.seq || (state.prompt !== null && candidate.seq === state.prompt.seq)) {
    for (const tool of state.toolCalls) toolCallsSet.add(tool)
  }

  return {
    eligible: true,
    target: {
      prompt: candidate.message,
      turnStartSeq: candidate.seq,
      turn: candidate.turn,
      replacement: {
        startSeq,
        endSeq,
        sourceEventSeqs: range,
      },
      toolCalls: [...toolCallsSet],
    },
  }
}

/**
 * Read the text a composer is seeded with when this prompt is edited.
 * @param prompt - the original human prompt recorded on the surface.
 * @returns the editable text, or an empty string when the prompt carries none.
 */
export function promptText(prompt: UserMessage): string {
  const texts = prompt.content
    .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
  return texts.join('\n')
}

/**
 * Build the resent message with only its first text block replaced.
 * @param prompt - the original human prompt recorded on the surface.
 * @param text - the edited text.
 * @returns the original message content with only its first text block changed.
 */
export function editPromptContent(prompt: UserMessage, text: string): UserMessage['content'] {
  const index = prompt.content.findIndex(block => block.type === 'text')
  if (index < 0) {
    return [{ type: 'text', text }, ...prompt.content]
  }
  return prompt.content.toSpliced(index, 1, { type: 'text', text })
}
