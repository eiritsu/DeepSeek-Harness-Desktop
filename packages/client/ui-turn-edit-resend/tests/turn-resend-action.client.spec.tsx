// @vitest-environment jsdom
/** The edit entry only appears on the latest turn, passes its seq, and opens the returned edit. */

import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TurnResendAction } from '../src/client/TurnResendAction.tsx'
import type { TurnResendEdit } from '../src/client/store.ts'

const edit: TurnResendEdit = {
  sessionId: 's1', operationId: 'op-1', turn: 2, startSeq: 10, text: 'original', toolCalls: [],
}

function bench(turn: number | undefined, seq = 10) {
  const beginEdit = vi.fn(async (_seq: number): Promise<TurnResendEdit | undefined> => edit)
  const begin = vi.fn()
  const useChat = ((selector: (snapshot: { timeline: { turnOrder: number[] } }) => unknown) =>
    selector({ timeline: { turnOrder: [1, 2] } })) as never
  const t = ((key: string) => key) as never
  const props = { seq, turn, beginEdit, useChat, t, sessionId: 's1', actions: { begin } }
  return { beginEdit, begin, props }
}

afterEach(cleanup)

describe('TurnResendAction', () => {
  it('renders on the latest turn, passes the clicked seq, and begins the returned edit', async () => {
    const { begin, beginEdit, props } = bench(2, 42)
    render(createElement(TurnResendAction, props as never))

    fireEvent.click(screen.getByRole('button', { name: 'action.label' }))
    await vi.waitFor(() => { expect(begin).toHaveBeenCalledWith(edit) })
    expect(beginEdit).toHaveBeenCalledWith(42)
  })

  it('renders nothing on an older turn', () => {
    const { props } = bench(1)
    const { container } = render(createElement(TurnResendAction, props as never))
    expect(container.querySelector('button')).toBeNull()
  })

  it('renders nothing when the message has no turn', () => {
    const { props } = bench(undefined)
    const { container } = render(createElement(TurnResendAction, props as never))
    expect(container.querySelector('button')).toBeNull()
  })
})
