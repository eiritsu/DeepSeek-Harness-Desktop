# Agent Note: Web profile 使用宿主侧统一上下文压缩

Status: implemented

[English](2026-09-03-web-host-compaction.md) | 中文

## Problem

Web 组合包禁用了三个压缩行，而完整 Agent Preset 各自挂载私有副本。因此行为取决于所选 preset：minimal 会话完全没有压缩，每个 preset 还各自携带阈值配置，尽管模型容量由共享的 LLM 路由解析。

## Decision

Web profile 在宿主平面挂载 `compaction-basic`、`command-compact` 与 `tool-result-pruner`。Web patch 写出三者的完整配置：启用自动压缩，压力阈值比例为 `0.8`，保留尾部比例为 `0.16`，压缩重试一次、溢出重试一次，工具结果字符预算为 `8192/4096/1024`。`compaction-basic` 根据路由模型公布的 `contextWindow` 解析具体 token 阈值，因此同一组比例会为每个提供方和模型路由生成对应容量的预算。Web Agent Preset 不再重复这三行。

## Alternatives considered

**继续在每个 preset 中挂载压缩。** 放弃，因为会话的压缩能力会随 preset 改变，minimal 会话也无法恢复超大的上下文。Web 产品需要每个会话都显式具备这一能力。

**同时挂载宿主和 preset 副本。** 放弃，因为自动监听器和工具结果剪枝可能对一次请求运行两次，两个命令注册也会产生取决于作用域的行为。

**为每个模型使用固定 token 阈值。** 放弃，因为模型目录和用户声明的路由各自携带容量；固定数值会过时，也无法覆盖新发现的模型。

## Consequences

每个 Web 会话（包括 minimal 与自定义 preset）都具备自动压力压缩、溢出恢复、无模型调用的工具结果剪枝与 `/compact`。token meter 仍由宿主所有，并由唯一的压缩服务共享。`sdk-minimal` 等独立 profile 仍保持自己的无压缩约定。

## Testing

`apps/cli/tests/web-agent-presets.e2e.ts` 启动发布的 Web 组合并断言宿主压缩引擎、按上下文窗口缩放的策略比例、剪枝配置、`/compact` 命令，以及 minimal preset 是否可用。相同回放中的 preset 工具和提示词断言保持通过。
