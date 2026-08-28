# Agent Note：新会话遵循当前 agent preset 默认值

Status: implemented

[English](2026-08-28-new-session-follows-agent-preset-default.md) | 中文

## 问题

Web 的“新会话”操作可能复用所选 Workspace 下的空白 Session。该策略只比较 Workspace 标识与归档状态，因此用户把默认值改为 `ptc` 后，按 `code` 或 `standard` 创建的空白 Session 仍可被复用。复用后的 Session 保留原来的 header preset，UI 也继续显示 `code`。随产品交付的 preset id 从 `code` 改成 `ptc` 后，恢复这类 Session 还会因为当前 roster 不再包含 `code` 而失败。

## 决策

Workspace 导航在选择可复用空白 Session 前，从 Host agent preset roster 读取当前默认值。只有空白 Session 的 `agentPreset` 投影等于该默认值时才可复用。完整决策位于既有的按 Workspace single-flight 内，因此并发的“新会话”操作会共享一次 roster 读取与一次创建，不会产生重复 Session。若 roster 无法提供默认值，则只有投影同样缺失的空白 Session 可以复用；记录了 preset 的 Session 绝不会在默认值未知时被接管。

`agentPreset` Session 投影会把创建 header 与选择事件中已停用的持久 id `code` 映射为 `ptc`。这只是范围很窄的持久记录别名，并不让当前配置或 roster API 接受 `code`。投影 state version 会推进，使缓存值重新计算。该决定修订了 [PTC 重命名决策](../architecture/2026-08-25-rename-code-mode-to-ptc.zh.md)关于持久 Session 的后果，同时保持当前配置标识严格。

## 验证

投影测试覆盖旧创建 header 与选择事件。Workspace 导航测试覆盖匹配时复用、不匹配时创建、默认值变更、roster 失败与并发调用。Host 与 contract typecheck 会确保 roster 投影仍属于生成的 Client surface。

## 考虑过的替代方案

**更改每个可复用空白 Session 的 preset。** 否决，因为复用会把导航副作用变成持久 Session 变更，且仍需处理重新组装失败后的恢复。

**在所有位置把 `code` 当作当前 preset id 接受。** 否决，因为配置与创作应只呈现当前 `ptc` 标识；只有更名前的 Session 记录已携带旧 id 的位置需要兼容。

**永不复用空白 Session。** 否决，因为既有 Workspace 流有意保留草稿与临时行。匹配 preset 能在不覆盖用户新默认值的前提下保留该行为。

## 后果

即使同一 Workspace 中存在较旧的空白 Session，更改默认值也会影响下一次“新会话”。旧空白 Session 仍会持久保留，并可被直接打开。携带 `code` 的既有 Session 记录会按 PTC 恢复，无需重写事件日志或更改 `SESSION_FORMAT_VERSION`。
