---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-29-turn-edit-resend

English | [中文](2026-09-29-turn-edit-resend.zh.md)

## Summary

Adds an optional `replacements` field to `agent/inbox/spliced.data` and three log-only `turn-resend/requested`, `turn-resend/request-started`, and `turn-resend/settled` events that record an edit-and-resend attempt.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-09-29-turn-edit-resend
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-09-16-session-format-v4"
    after: "d407e975f1520a7b28fbf6bc0f28aebf8a3bfbefed059fc26992a23364cd91b3"
    decision: same-version
  - root: "event:turn-resend/request-started"
    previous: null
    after: "a905b4966f75da47cf8440bbb0dea1b40f3a800d6df27a62e045ba590949fa17"
    decision: same-version
  - root: "event:turn-resend/requested"
    previous: null
    after: "f6c551984308611eafd933f73a031410cd9ad4b3d456876e903212164bc83af4"
    decision: same-version
  - root: "event:turn-resend/settled"
    previous: null
    after: "0eefec399ea3aa0f91a07126d03deb32ff3a209a909da21fe38123aa4c27bae1"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Same-version. The added `replacements` field is optional, so every log written before it replays unchanged; the three new roots are written only by the `dsh-session-turn-edit-resend` Host service when it is mounted, and a build that does not load that package refuses a log containing them, as required-on-read for an unknown event type.

<a id="verification"></a>
## Verification

Focused unit coverage in the Bundle and agent-loop suites pins the resend splice, the operation journal fold, and the pre-request flush barrier; the generated `known-event-types` list and persistence catalog carry the new roots.

<a id="dev-note"></a>
## Dev Note

None.
