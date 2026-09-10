# Agent Note: 会话搜索工具不是交付默认项

Status: implemented

[English](2026-08-02-session-search-not-shipped-default.md) | 中文

## 问题

[交付清单决策](2026-07-31-even-out-shipped-tool-rosters.zh.md)把 `tool-session-query` 设为共享 [`cordis.patch.yml`](../../../../packages/bundle/base/cordis.patch.yml) 的默认行，于是交付的 TUI 与 Web surface 把这五个会话搜索工具（`session_search`、`session_event_search`、`session_trace`、`session_event_trace`、`session_event_read`）呈现给了模型。这与[面向模型的会话查询工具决策](2026-07-24-model-facing-session-query-tools.zh.md)相抵触，该决策持需显式启用的立场，包 README 将其记录为「shipped host compositions do not mount it by default」。这项默认设置还交付了一个提示词段，向模型讲授一套既往工作搜索工作流，而没有任何用户要求过。

## 决策

交付的 TUI、普通浏览器 Web 与无头 surface 均不挂载 `@deepseek-ai/dsh-tool-session-query`，交付的 agent preset 也都不包含它。该消费方仍保持 opt-in，与面向模型的会话查询工具决策所述完全一致：[session-query 快照组合](../../../../snapshots/session/session-query-spill/cordis.yml)仍是挂载参考，自定义组合也可以连同超时与 spill 策略一起挂载该包。macOS 桌面 Web profile 是唯一的交付例外：`DSH_DESKTOP_SHELL=1` 会挂载五个只读工具，让桌面会话可以查询 App 拥有的持久化服务，无需使用 Bash 扫描 Application Support。

`ctx.sessionQuery` 服务本身保持挂载。`session-query-sqlite` 仍是 base 的一行，TUI 的 `session-reference` 消费它来实现 `/resume`；其全文索引默认关闭（`openAt: never`，见[内容搜索 opt-in 决策](../architecture/2026-08-13-session-content-search-opt-in.zh.md)），Web overlay 保留内存索引取值，供启用内容搜索的部署使用。被移除的只有面向模型的消费方。

## 曾考虑的替代方案

- **把 `session-query-sqlite` 索引也一并移除**——否决，因为 `/resume` 和 Web 内容搜索框直接消费 `ctx.sessionQuery`；它们是宿主功能，不是模型工具，移除提供方会破坏它们。
- **保留该行，但在每个 overlay 中禁用它**——否决，因为一条被禁用的 base 行仍会交付依赖，而且一行就能轻易重新启用；已记录的 opt-in 立场要求消费方不出现在交付的 surface 上，以 ACP 示例作为挂载参考。
- **只在 TUI 上挂载**——否决，因为共享 base 是所有 surface 共用的一组行；surface 专属挂载会重新引入交付清单决策所消除的清单分裂。

## 后果

普通交付 surface 仍保留同样的二十个无条件工具（ripgrep 可用时再加上 `glob`/`grep`），五个会话搜索 schema 及其提示词段仍不会进入它们的默认请求。桌面请求包含这五个 schema，并使用经工作区授权的派生索引。组合测试会固定两种结果。其他 surface 上想要会话搜索的用户从个人 overlay 或 ACP 示例挂载该消费方，并在挂载处添加依赖。
