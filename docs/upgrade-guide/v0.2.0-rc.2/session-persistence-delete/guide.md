---
kind: upgrade-guide
description: "SessionPersistence gains a required abstract delete() and AgentHandle a required disposeIfIdle(); out-of-tree subclasses and handle literals stop compiling."
---

# `SessionPersistence` requires `delete()` and `AgentHandle` requires `disposeIfIdle()`

English | [中文](guide.zh.md)

## Change

v0.2.0-rc.2 adds physical Session deletion. Two published seams gained a required member:

- `SessionPersistence` declares `abstract delete(id: SessionId): Promise<void>`, which removes one stored Session and every committed format generation. `JsonlSessionPersistence` implements it.
- `AgentHandle` declares `disposeIfIdle(): Promise<boolean>`, which seals an Agent against new input and disposes it only when it is idle with nothing queued.

Both are TypeScript interfaces, so an out-of-tree package that extends `SessionPersistence` or builds an `AgentHandle` literal stops compiling with `TS2515` or `TS2739` naming the missing member. Runtime behavior is unchanged for anyone who does not subclass or construct these types: no Session is deleted unless a caller asks for it.

## Migration

1. In a custom `SessionPersistence` subclass, throw `SessionPersistenceNotFoundError` when the stored Session is absent and `SessionAlreadyOwnedError` while a writer owns it. Remove every committed generation under the backend's deletion lock:

   ```ts
   import type { SessionId } from '@deepseek-ai/dsh-session'
   import { SessionAlreadyOwnedError, SessionPersistenceNotFoundError } from '@deepseek-ai/dsh-session-persistence'

   class ExamplePersistence {
     private readonly entries = new Map<SessionId, readonly unknown[]>()
     private readonly writers = new Set<SessionId>()

     async delete(id: SessionId): Promise<void> {
       if (this.writers.has(id)) throw new SessionAlreadyOwnedError(id)
       if (!this.entries.delete(id)) throw new SessionPersistenceNotFoundError(id)
     }
   }
   ```

2. In code that builds an `AgentHandle` literal, add the member. Returning `false` leaves the Agent untouched, which suits a test double:

   ```ts
   import type { AgentHandle } from '@deepseek-ai/dsh-agent'

   declare const agent: AgentHandle['agent']
   const handle: AgentHandle = {
     agent,
     disposeIfIdle: () => Promise.resolve(false),
     dispose: () => Promise.resolve(),
   }
   ```

3. Confirm: `pnpm run typecheck` reports no missing `delete` or `disposeIfIdle` member, and `pnpm run test` passes. Both members are already required on the built-in `JsonlSessionPersistence` and Agent Loop handle.
