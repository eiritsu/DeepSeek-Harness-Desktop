# Agent Note: 工具调用兼容性默认值与展示元数据

Status: implemented

[English](2026-09-02-tool-call-compatibility.md) | 中文

## Problem

PTC-only 会话只把 `run_code` 作为可调用传输工具。遵循原生工具 schema 的模型，或在 `bash`、`pwsh`、`run_code` 调用中省略仅用于 UI 的 `description` 字段时，会在请求的操作执行前收到 Harness 参数错误。这样就把展示元数据和选中的 agent preset 变成了不必要的执行失败来源。

## Decision

随附的 `ptc` agent preset 同时公开原生工具 schema 与 `run_code`。普通模型以及直接的图片、文件和 shell 操作仍可使用原生调用；批量 SDK 分发仍可使用 `run_code`。`both` 下 `tools:ptc-only` 说明为空，因此提示词不会声称原生工具名被禁止。

`bash`、`pwsh` 和 `run_code` 的 `description` 参数改为可选。执行器继续拒绝明确传入的空白 description；省略该字段时使用确定性的展示标签（`Run bash command`、`Run PowerShell command` 或 `Run code`）。这些标签只属于 UI 元数据，不改变命令、程序或结果语义。

## Alternatives considered

**保留 PTC-only preset 并依赖模型自行纠正。** 拒绝，因为模型必须先为周边指导中看到的工具名收到一次错误，而部分提供方会重复发出原生调用。保留原生 schema 可以消除协议不匹配，同时不移除批量传输工具。

**继续要求 description 并只改进提示词措辞。** 拒绝，因为 `description` 是展示元数据，不是执行前置条件。缺少可选标签不应阻止有效命令或程序；明确传入空白标签仍然无效，以便发现错误的输入。

**从命令或源代码文本推导标签。** 拒绝，因为命令和代码可能包含密钥或无关的用户内容。固定的通用标签可以在不复制可执行文本到 UI 元数据的情况下提供稳定卡片。

## Consequences

`ptc` preset 同时携带原生 schema 与生成的 SDK，因此提示词 token 增加；代价是请求前缀变大，收益是兼容无法稳定生成嵌套调用的模型。模型省略展示元数据时工具卡片仍可读，shell 或程序执行也不再仅因缺少展示字段而失败。聚焦测试覆盖 schema 可选性、回退执行与展示，以及 preset 的原生加 PTC 组装结果。
