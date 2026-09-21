import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  assertFixtureInventory,
  compareOrRefreshGolden,
  fixtureIdentity,
  launchWebScaffold,
  seedSession,
  type WebScaffold,
} from './scaffold.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/retry-interrupted-protocol', import.meta.url))
const SESSION_FIXTURE = join(SNAPSHOT_DIR, 'session.v3.jsonl')
const PROTOCOL_EXPECTED = join(SNAPSHOT_DIR, 'protocol.expected.json')
const SESSION_ID = 'retry-interrupted-protocol'
const MESSAGE_ID = fixtureIdentity('message', 2)

interface ProtocolExchange {
  readonly endpoint: string
  readonly request: unknown
  readonly status: number
  readonly response: unknown
}

/** One model-visible message projected from the live Session's surface. */
interface DerivedMessage {
  readonly role: string
  readonly content: readonly { readonly type: string; readonly text?: string }[]
  readonly source: { readonly kind: string }
}

/** Structural view of the scaffold's live Session store, avoiding a deep type import. */
function sessionsOf(scaffold: WebScaffold): {
  get(id: string): { deriveMessages(): readonly DerivedMessage[] } | undefined
} {
  return (scaffold.ctx as unknown as {
    sessions: { get(id: string): { deriveMessages(): readonly DerivedMessage[] } | undefined }
  }).sessions
}

/** Replace only the run-owned addressed message id; protocol names and fields stay exact. */
function normalizeProtocol(exchanges: readonly ProtocolExchange[]): string {
  return JSON.stringify(exchanges, (key, value: unknown) => {
    if (key === 'messageId' && value === MESSAGE_ID) return '{{message:2}}'
    return value
  }, 2)
}

describe('interrupted-answer retry Host Remote protocol', () => {
  let scaffold: WebScaffold
  let sessionId: Awaited<ReturnType<typeof seedSession>>

  beforeAll(async () => {
    scaffold = await launchWebScaffold()
    sessionId = await seedSession(scaffold, await readFile(SESSION_FIXTURE, 'utf8'), SESSION_ID)
  })

  afterAll(async () => {
    await scaffold?.close()
  })

  it('replays the original prompt once and shadows the interrupted partial in model history', async () => {
    const exchanges: ProtocolExchange[] = []
    const invoke = async (rpcId: string, endpoint: string, request: unknown): Promise<unknown> => {
      const payload = { args: { request } }
      const response = await scaffold.hostFetch(`/api/${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'client-request',
          rpcId,
          method: endpoint,
          payload,
        }),
      })
      const body: unknown = await response.json()
      exchanges.push({ endpoint: `/api/${endpoint}`, request: payload, status: response.status, response: body })
      return body
    }

    const response = await invoke('retry-interrupted', 'session/retryInterrupted', {
      sessionId,
      messageId: MESSAGE_ID,
    })
    expect(response).toMatchObject({ result: { ok: true, value: { accepted: true } } })

    // Read the live Host Session structurally: the snapshot asserts its derived
    // model history without pulling the Session class into this program.
    const session = sessionsOf(scaffold).get(sessionId)
    if (session === undefined) throw new Error('seeded session was not attached')
    await vi.waitFor(() => {
      expect(session.deriveMessages().some(message =>
        message.role === 'user' && message.source.kind === 'assistant-retry')).toBe(true)
    })

    // The active surface replays the original prompt exactly once; the
    // interrupted partial is shadowed from derived history while remaining in
    // the append-only log. The retry turn's own injected runtime context is
    // expected and carries no prompt text.
    const derived = session.deriveMessages()
    const userTexts = derived
      .filter(message => message.role === 'user')
      .flatMap(message => message.content)
      .flatMap(block => block.type === 'text' ? [block.text] : [])
    expect(userTexts.filter(text => text === 'Explain the plan.')).toHaveLength(1)
    const assistantTexts = derived
      .filter(message => message.role === 'assistant')
      .flatMap(message => message.content)
      .flatMap(block => block.type === 'text' ? [block.text] : [])
    expect(assistantTexts.join('')).not.toContain('half an answer')
    expect(userTexts.join('')).not.toContain('half an answer')

    await compareOrRefreshGolden(PROTOCOL_EXPECTED, normalizeProtocol(exchanges), scaffold.mode)
    await assertFixtureInventory(SNAPSHOT_DIR, ['protocol.expected.json', 'session.v3.jsonl'])
  })
})
