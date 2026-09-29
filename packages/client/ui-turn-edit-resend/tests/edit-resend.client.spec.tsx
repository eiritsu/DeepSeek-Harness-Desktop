// @vitest-environment jsdom
/** The edit-and-resend card: disclosure, submission, and durable outcome copy. */

import { createElement, useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditResendCard } from '../src/client/EditResendCard.tsx'
import { createTurnResendStore, type TurnResendEdit, type TurnResendOutcome } from '../src/client/store.ts'

const edit: TurnResendEdit = {
  sessionId: 's1', operationId: 'op-1', turn: 2, startSeq: 5, text: 'original', toolCalls: ['echo', 'write'],
}

function bench(open = true) {
  const instance = createTurnResendStore().create('s1')
  if (open) instance.actions.begin(edit)
  const submit = vi.fn(async (_edit: TurnResendEdit): Promise<TurnResendOutcome | undefined> => undefined)
  const t = ((key: string, params?: Record<string, string>) =>
    params === undefined ? key : `${key}:${Object.values(params).join(',')}`) as never
  const useStore = ((selector: (state: ReturnType<typeof instance.getSnapshot>) => unknown) =>
    useSyncExternalStore(instance.subscribe, () => selector(instance.getSnapshot()))) as never
  const props = { sessionId: 's1', submit, t, useStore, actions: instance.actions }
  return { instance, submit, props }
}

afterEach(cleanup)

describe('EditResendCard', () => {
  it('discloses the tool calls and submits the edited text', () => {
    const { props, submit } = bench()
    render(createElement(EditResendCard, props as never))

    expect(screen.getByText('card.warning.tools:echo, write')).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'edited' } })
    fireEvent.click(screen.getByText('card.save'))

    expect(submit).toHaveBeenCalledTimes(1)
    expect(submit.mock.calls[0]![0]).toMatchObject({ text: 'edited', operationId: 'op-1' })
  })

  it('reports an uncertain attempt and offers no repeat', () => {
    const { props, instance } = bench()
    render(createElement(EditResendCard, props as never))
    act(() => { instance.actions.settle('s1', { kind: 'uncertain' }) })

    expect(screen.getByText('card.uncertain')).toBeTruthy()
    expect(screen.queryByText('card.save')).toBeNull()
    expect(screen.getByText('card.cancel')).toBeTruthy()
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('original')
  })

  it('reports a refusal with its reason and keeps the attempt editable', () => {
    const { props, instance } = bench()
    render(createElement(EditResendCard, props as never))
    act(() => { instance.actions.settle('s1', { kind: 'refused', refusal: 'agent-busy' }) })

    expect(screen.getByText('card.refused:agent-busy')).toBeTruthy()
    expect(screen.getByText('card.save')).toBeTruthy()
  })

  it('renders nothing with no open edit', () => {
    const { props } = bench(false)
    const { container } = render(createElement(EditResendCard, props as never))
    expect(container.querySelector('[data-turn-resend-card]')).toBeNull()
  })
})
