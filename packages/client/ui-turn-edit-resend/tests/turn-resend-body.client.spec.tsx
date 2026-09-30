// @vitest-environment jsdom
/** The in-place body editor: disclosure, submission, notices, and dismissal. */

import { createElement, useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TurnResendBody } from '../src/client/TurnResendBody.tsx'
import { createTurnResendStore, type TurnResendEdit, type TurnResendOutcome } from '../src/client/store.ts'

const edit: TurnResendEdit = {
  sessionId: 's1', operationId: 'op-1', turn: 2, startSeq: 5, text: 'original', toolCalls: ['echo', 'write'],
}

function bench(open = true) {
  const instance = createTurnResendStore().create('s1')
  if (open) instance.actions.begin(edit)
  const submit = vi.fn(async (_edit: TurnResendEdit): Promise<TurnResendOutcome | undefined> => undefined)
  const release = vi.fn()
  const t = ((key: string, params?: Record<string, string>) =>
    params === undefined ? key : `${key}:${Object.values(params).join(',')}`) as never
  const useStore = ((selector: (state: ReturnType<typeof instance.getSnapshot>) => unknown) =>
    useSyncExternalStore(instance.subscribe, () => selector(instance.getSnapshot()))) as never
  const props = {
    matched: { seq: 5 }, sessionId: 's1', release, submit, t, useStore, actions: instance.actions,
  }
  return { instance, release, submit, props }
}

afterEach(cleanup)

describe('TurnResendBody', () => {
  it('discloses the tool calls and submits the edited text', () => {
    const { props, submit } = bench()
    render(createElement(TurnResendBody, props as never))

    expect(screen.getByText('card.warning.tools:echo, write')).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'edited' } })
    fireEvent.click(screen.getByText('card.save'))

    expect(submit).toHaveBeenCalledTimes(1)
    expect(submit.mock.calls[0]![0]).toMatchObject({ text: 'edited', operationId: 'op-1' })
  })

  it('closes the presentation and releases the body claim after admission', async () => {
    const { instance, props, release } = bench()
    render(createElement(TurnResendBody, props as never))

    fireEvent.click(screen.getByText('card.save'))
    await vi.waitFor(() => { expect(release).toHaveBeenCalledTimes(1) })
    expect(instance.getSnapshot().editing.s1).toBeUndefined()
  })

  it('reports an uncertain attempt and offers no repeat', () => {
    const { props, instance } = bench()
    render(createElement(TurnResendBody, props as never))
    act(() => { instance.actions.settle('s1', { kind: 'uncertain' }) })

    expect(screen.getByText('card.uncertain')).toBeTruthy()
    expect(screen.queryByText('card.save')).toBeNull()
    expect(screen.getByText('card.cancel')).toBeTruthy()
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('original')
  })

  it('reports a refusal with its reason and keeps the attempt editable', async () => {
    const { props, instance, submit } = bench()
    submit.mockResolvedValueOnce({ kind: 'refused', refusal: 'agent-busy' })
    render(createElement(TurnResendBody, props as never))
    fireEvent.click(screen.getByText('card.save'))
    await vi.waitFor(() => { expect(screen.getByText('card.refused:agent-busy')).toBeTruthy() })
    expect(screen.getByText('card.save')).toBeTruthy()
    expect(instance.getSnapshot().editing.s1).toBeDefined()
  })

  it('hides the tool disclosure for a turn that ran none', () => {
    const { props, instance } = bench()
    instance.actions.begin({ ...edit, toolCalls: [] })
    const { container } = render(createElement(TurnResendBody, props as never))

    expect(container.querySelector('[data-turn-resend-warning]')).toBeNull()
  })

  it('keeps edits with no open attempt out of the store', () => {
    const instance = createTurnResendStore().create('s1')
    instance.actions.setText('s1', 'ignored')
    expect(instance.getSnapshot().editing.s1).toBeUndefined()
  })

  it('states every other recorded outcome in the editor', () => {
    const cases: readonly [TurnResendOutcome, string][] = [
      [{ kind: 'not-admitted' }, 'card.notAdmitted'],
      [{ kind: 'failed', reason: 'disk full' }, 'card.failed:disk full'],
      [{ kind: 'pending' }, 'card.pending'],
      [{ kind: 'remote-failed', code: 'gateway/internal' }, 'card.remoteFailed:gateway/internal'],
    ]
    for (const [outcome, copy] of cases) {
      const { props, instance } = bench()
      const view = render(createElement(TurnResendBody, props as never))
      act(() => { instance.actions.settle('s1', outcome) })
      expect(screen.getByText(copy)).toBeTruthy()
      view.unmount()
    }
  })

  it('states a click the Host answered without an edit and dismisses it', () => {
    const { props, instance, release } = bench(false)
    render(createElement(TurnResendBody, props as never))
    act(() => {
      instance.actions.notice('s1', { seq: 5, outcome: { kind: 'refused', refusal: 'no-replaceable-turn' } })
    })

    expect(screen.getByText('card.refused:no-replaceable-turn')).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
    fireEvent.click(screen.getByText('card.dismiss'))
    expect(screen.queryByText('card.refused:no-replaceable-turn')).toBeNull()
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('renders nothing when the presentation belongs to another message', () => {
    const { props, instance } = bench(false)
    render(createElement(TurnResendBody, props as never))
    act(() => {
      instance.actions.notice('s1', { seq: 9, outcome: { kind: 'refused', refusal: 'no-replaceable-turn' } })
    })
    expect(screen.queryByText('card.refused:no-replaceable-turn')).toBeNull()
  })

  it('renders nothing with no open presentation', () => {
    const { props } = bench(false)
    const { container } = render(createElement(TurnResendBody, props as never))
    expect(container.querySelector('[data-turn-resend-body]')).toBeNull()
  })
})
