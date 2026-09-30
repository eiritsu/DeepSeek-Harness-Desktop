// @vitest-environment jsdom
/** User-message body claims: registry semantics and the node renderer's chain dispatch. */

import { createElement } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { ChainRenderOpts, OwnerOf } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { MessageBodyClaims } from '../src/client/message-claims.ts'
import { UserMessageNodeView } from '../src/client/chat/MessageItem.tsx'
import type { ChatNode } from '../src/client/contract/chat-nodes.ts'
import type { UserMessageBodyOwnerProps } from '../src/client/contract/slots.ts'
import { zh } from '../src/client/locale.ts'

const SID = 'session-claims' as SessionId

afterEach(cleanup)

describe('MessageBodyClaims', () => {
  it('moves one Session source only when a claim moves', () => {
    const claims = new MessageBodyClaims()
    const source = claims.source(SID)
    expect(source.getSnapshot()).toEqual(new Set())

    const release = claims.claim(SID, 5, 'owner')
    const claimed = source.getSnapshot()
    expect(claimed).toEqual(new Set([5]))

    release()
    expect(source.getSnapshot()).toEqual(new Set())
    // Stable source identity and snapshot identity between changes.
    expect(claims.source(SID)).toBe(source)
    expect(source.getSnapshot()).toBe(source.getSnapshot())
  })

  it('keeps the newest claim when a replaced claim releases', () => {
    const claims = new MessageBodyClaims()
    const source = claims.source(SID)
    const first = claims.claim(SID, 5, 'first')
    const second = claims.claim(SID, 5, 'second')

    first()
    expect(source.getSnapshot()).toEqual(new Set([5]))
    second()
    expect(source.getSnapshot()).toEqual(new Set())
  })
})

describe('UserMessageNodeView body chain', () => {
  const userNode: ChatNode<'user'> = {
    key: 'fixture:user:5',
    kind: 'user',
    id: '5',
    target: 'chat',
    anchorSeq: 5,
    location: { kind: 'session' },
    visibility: 'visible',
    data: { kind: 'user', seq: 5, time: 1, source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] },
  }

  function bench() {
    const claims = new MessageBodyClaims()
    const owner = vi.fn()
    const renderSlotChain = <K extends 'conversation.chat.user-body'>(
      key: K,
      ownerProps: OwnerOf<K>,
      opts?: ChainRenderOpts,
    ): ReactNode => {
      const { seq, turn, claimed } = ownerProps as UserMessageBodyOwnerProps
      owner({ key, seq, turn, claimed })
      // The shipped chain keeps the fallback mounted and hides it while an
      // entry is elected; the elected marker stands in for an occupant.
      return createElement('div', null, opts?.fallback, claimed
        ? createElement('div', { 'data-testid': 'claimed' })
        : null)
    }
    const props: Partial<ComponentProps<typeof UserMessageNodeView>> = {
      node: userNode,
      t: makeTranslate(zh, commonZh),
      renderMessageImages: () => null,
      openFile: vi.fn(),
      openSkill: vi.fn(),
      useMessageClaims: bindSnapshotSelector(claims.source(SID)),
      renderSlotChain,
    }
    return { claims, owner, props, renderSlotChain }
  }

  it('renders the bubble through the chain and reports claims per message', () => {
    const { claims, owner, props } = bench()
    render(createElement(UserMessageNodeView, props as ComponentProps<typeof UserMessageNodeView>))

    expect(owner).toHaveBeenCalledWith(expect.objectContaining({ seq: 5, claimed: false }))
    expect(screen.getByText('hello')).toBeTruthy()
    expect(screen.queryByTestId('claimed')).toBeNull()

    act(() => { claims.claim(SID, 5, 'test') })
    expect(owner).toHaveBeenLastCalledWith(expect.objectContaining({ seq: 5, claimed: true }))
    expect(screen.getByTestId('claimed')).toBeTruthy()
  })
})
