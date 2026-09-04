# Agent Note: Recover Lark Agent routes and release idle lifecycles

Status: implemented

English | [中文](2026-09-04-lark-agent-route-and-deletion-lifecycle.zh.md)

## Problem

Desktop model settings can be written after a Lark conversation Agent was created. That Agent then retains empty construction-time provider/model options, so a later message fails before adapter dispatch even though the Web client displays a valid model. The Lark bridge also retained its own idle Agent handle indefinitely, which made the Session Controller correctly reject deletion by a different lifecycle owner.

## Decision

The Lark bridge installs an `agent/request` fallback on each Lark-owned or discovered Lark Agent. When the request remains unrouted, the listener reads the current process default selection and supplies its provider/model pair, preserving an explicit route and reasoning effort. Lark-created handles are released after the last in-flight message for that session settles; persisted session history remains the source for the next message. Agents owned by another client are never disposed by the bridge, although the bridge releases only its own scoped context additions.

## Alternatives considered

**Recreate every route-less Agent immediately after model settings change.** The bridge cannot safely replace an Agent owned by the Web client, and replacing a live lifecycle would race in-flight turns. Request-time fallback repairs the missing route at the extension point designed for late routing.

**Allow the Session Controller to force-dispose any external Agent during deletion.** This would weaken the AgentHandle ownership guarantee and could terminate another transport's running work. Releasing idle Lark-owned handles keeps deletion within the existing ownership rules.

**Keep one persistent Lark Agent per chat and add a special deletion RPC.** That would require a second cross-component deletion protocol and still leave stale ownership windows. Reopening the durable session for each message is bounded and lets ordinary deletion proceed once work settles.

## Consequences

An old Lark session created before a default model was configured can now use the current default route without requiring a manual reasoning-level change. The UI's `Default` reasoning choice remains provider-default behavior; it is not treated as evidence that a model lacks support. A Lark Agent is live only while a message is being handled, so completed conversations no longer block user deletion. The cost is one persistence-backed resume per later message and no in-memory Agent cache across idle periods.

The Lark conversation tests cover route fallback, persisted redelivery, attachment handling, external-Agent configuration, and idle-handle release. Package typecheck and the focused conversation suite must pass before the rebuilt plugin artifact is included in a desktop release.
