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
 * Select the latest replaceable human turn, or the reason no turn is eligible.
 *
 * The current surface determines the replacement range. A projected prompt
 * that an earlier replacement removed is no longer eligible.
 * @param session - session whose current surface is read.
 * @param state - incrementally folded turn facts.
 * @returns the eligible target, or the refusal that excludes it.
 */
export function selectResendTarget(session: Session, state: ResendTurnState): ResendSelection {
  const end = state.latestEnd
  const start = state.latestStart
  if (end === null || !end.replaceable) return refuse('no-replaceable-turn')
  if (start !== null && start.seq > end.seq) return refuse('not-latest-turn')
  if (start === null || start.turn !== end.turn || start.seq >= end.seq) return refuse('no-replaceable-turn')

  const prompt = state.prompt
  if (prompt === null || !session.surface.nodes.includes(prompt.seq)) return refuse('no-human-prompt')
  const range = session.surface.nodes.filter(seq => seq >= prompt.seq && seq < end.seq)
  if (range[0] !== prompt.seq) return refuse('no-human-prompt')

  if (promptText(prompt.message) === undefined) return refuse('no-editable-text')
  const endSeq = range.at(-1)
  if (endSeq === undefined) return refuse('no-human-prompt')

  return {
    eligible: true,
    target: {
      prompt: prompt.message,
      turnStartSeq: start.seq,
      turn: end.turn,
      replacement: {
        startSeq: prompt.seq,
        endSeq,
        sourceEventSeqs: range,
      },
      toolCalls: [...state.toolCalls],
    },
  }
}

/**
 * Read the text a composer is seeded with when this prompt is edited.
 * @param prompt - the original human prompt recorded on the surface.
 * @returns the editable text, or undefined when the prompt carries none.
 */
export function promptText(prompt: UserMessage): string | undefined {
  const block = prompt.content.find(candidate => candidate.type === 'text')
  return block?.type === 'text' ? block.text : undefined
}

/**
 * Build the resent message with only its first text block replaced.
 * @param prompt - the original human prompt recorded on the surface.
 * @param text - the edited text.
 * @returns the original message content with only its first text block changed.
 * @throws when the prompt carries no text block.
 */
export function editPromptContent(prompt: UserMessage, text: string): UserMessage['content'] {
  const index = prompt.content.findIndex(block => block.type === 'text')
  if (index < 0) throw new Error('the prompt to edit carries no text block')
  return prompt.content.toSpliced(index, 1, { type: 'text', text })
}
