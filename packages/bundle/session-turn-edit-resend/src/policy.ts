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
    }
  } else {
    const surfacePrompts = state.prompts.filter(p => session.surface.nodes.includes(p.seq))
    if (surfacePrompts.length > 0) {
      candidate = surfacePrompts.at(-1)
    } else if (state.prompt !== null && session.surface.nodes.includes(state.prompt.seq)) {
      candidate = { seq: state.prompt.seq, turn: state.latestStart?.turn ?? 1, message: state.prompt.message }
    }
  }

  if (candidate === undefined) return refuse('no-replaceable-turn')
  if (!session.surface.nodes.includes(candidate.seq)) return refuse('no-human-prompt')
  if (promptText(candidate.message) === undefined) return refuse('no-editable-text')

  const startIdx = session.surface.nodes.indexOf(candidate.seq)
  if (startIdx === -1) return refuse('no-human-prompt')

  const range = session.surface.nodes.slice(startIdx)
  const endSeq = range.at(-1)
  if (endSeq === undefined) return refuse('no-human-prompt')

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
        startSeq: candidate.seq,
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
