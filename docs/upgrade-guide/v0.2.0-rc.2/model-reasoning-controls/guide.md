---
kind: upgrade-guide
description: "Official DeepSeek discovery now requires a key, and saved reasoning choices must match the model's current controls."
---

# Model discovery and reasoning choices follow current capabilities

English | [中文](guide.zh.md)

## Change

After v0.2.0-rc.2, `ctx.llm.listModels('deepseek-official')` returns `[]` until `DEEPSEEK_API_KEY` resolves, so selectors omit that route. Direct requests still fail with `MISSING_CREDENTIAL` without a key.

The reasoning menu follows current route/model metadata. MiniMax M3 exposes `on`/`off` (shown as Enabled/Off); M3.1 Flash Preview exposes `low`, `medium`, `high`, `xhigh`, and `max`; M2.7 advertises no grade choices. A saved effort the model no longer offers remains unsupported, and requests fail with `UNSUPPORTED_REASONING_EFFORT` rather than changing levels. `high` remains valid on M3.1 and native DeepSeek Messages. Native SDK budgets, `reasoningEffort`, and `maxTokens` remain available.

## Migration

1. To list official models, resolve a valid key through credentials or the launch environment before `listModels()`. In the app, use **Settings → Models**; a read-only environment key can remain.
2. For each Session showing **Unsupported effort**, open the selected model's reasoning menu and choose **Default** or a listed value. **Default** clears the explicit effort and uses the model/route default. The picker appends a normal selection event; earlier Session events remain. Confirm the unsupported label is gone. Do not edit or delete Session files.
