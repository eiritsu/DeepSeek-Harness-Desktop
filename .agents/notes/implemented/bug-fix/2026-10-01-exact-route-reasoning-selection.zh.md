# Agent Note: 精确路由推理选择

Status: implemented

[English](2026-10-01-exact-route-reasoning-selection.md) | 中文

## Problem

全局统一的推理等级阶梯让每个模型选择器都渲染同样的行，不管已解析的路由报告了什么。于是 Session 的模型选择器会宣传它背后那条路由无法编码的等级，甚至对已解析元数据未声明任何等级的模型也照常提供该控件。选中某一行是唯一能知道请求会失败的方式，而一个列出路由从未声明过的等级的菜单，并不描述将要编码该请求的那条路由。

推理控件是关于服务端点的事实。当前目录只在 coding-plan provider 条目下声明 MiniMax M3.1 等级，而已发布的 coding-plan API endpoint 与自定义路由使用的 provider endpoint 相同。只有规范化后的 API endpoint 匹配且所有匹配声明一致时，自定义路由才能采用这些声明；仅 provider 同级关系不能作为依据。二元开关仍是开关，不会变成推理等级阶梯。

## Decision

**Session 选择器描述已解析的确切路由与模型。** Session 模型目录按适配器顺序复制 `LlmResolvedModelInfo.reasoning.efforts`，并保留路由所报告的确切默认等级。当已解析的模型信息不带推理元数据时，目录省略 reasoning 字段，选择器不渲染任何等级控件。这修正了[共享模型目录与统一推理等级阶梯](../feature/2026-09-29-shared-model-catalog-and-reasoning-ladder.zh.md) 中属于选择器的那一半；共享模型目录的各类事实与请求阶段的拒绝，仍按那篇记录的方式成立。

**不做降级。** 选择器绝不把路由未声明的等级替换成邻近的等级，`LlmRuntime` 仍然以 `UNSUPPORTED_REASONING_EFFORT` 拒绝路由不支持的、已过期或被伪造的显式等级，并记录为该轮的错误。因此，在路由改变其所声明内容之前存下的选择，会以指明原因的方式失败，而不是在无人选择的等级下被作答。

**由已解析端点选择兼容的目录声明。** provider 身份和 endpoint 元数据会在旧 basename 之前解析。自定义路由只有在 models.dev API URL 与它的 HTTP(S) 主机、非版本路径及查询参数匹配时，才能采用通道声明；尾部 `/v1`、`/anthropic` 和 `/anthropic/v1` 协议后缀互相兼容。多个匹配声明必须在控件种类、toggle 支持和等级值上相同。不相关的同级 provider、aggregator 或部署路径不会把等级带到该路由。

## Alternatives considered

**保留统一的那些行，让请求去拒绝。** 一个提供路由无法编码的等级的菜单，会把一个配置事实变成逐轮失败；而要知道一条路由接受什么，唯一的办法是先失败一次。

**降级到路由所声明的最接近等级。** 悄悄替换是人唯一察觉不到的结局：这一轮成功、记录看起来正常，而答案是在无人选择的等级下产生的。

**没有端点身份时从同级 coding-plan 渠道推断路由等级。** 提供同一模型的两个渠道是各自拥有独立词汇的两条路由；只有唯一匹配的已发布 API endpoint 和明确声明能将它们关联起来。

**只对目录从未听说过的模型不渲染控件。** 条件是缺少推理元数据，而不是模型身份：目录已知的模型若所在路由未声明任何等级，同样没有可列出的内容。

## Consequences

- Session 选择器按适配器顺序列出已解析的路由与模型所报告的确切等级，并保留路由所报告的确切默认值。
- 已解析元数据未声明任何等级的模型不列出任何等级行，因此这种缺失是可见的，而不是由 harness 填上的。
- 确切路由不再列出的已存显式等级会标为不受支持，而不会呈现为正在使用的等级；推理等级面板的 Default 操作会通过选择调用将其清除，仅渲染本身绝不改写已存选择。
- 与已发布 coding-plan API endpoint 匹配的自定义路由可以使用 MiniMax M3.1 当前声明的五种推理等级；不相关渠道和路径无法提供这些等级。
- 路由不接受的等级仍然会让一轮以 `UNSUPPORTED_REASONING_EFFORT` 失败，因此在较早配置下存下的选择会保留它指明原因的错误，而不会被换成另一个等级来作答。
- 给 harness 阶梯增加一个等级不会改变人在这个选择器里看到的任何内容，因此阶梯与选择器不会再无声地各走各的。

## Testing

聚焦测试覆盖端点关联的 provider 声明、端点声明冲突、toggle、空控件列表，以及必须优先于旧 basename 解析的 DeepSeek alias。本地抓取的 payload 覆盖 MiniMax M3 在 Completions、Responses 和 Anthropic API 上的 Default/On/Off，以及 M3.1 的五个等级。组件测试覆盖路由精确子集之外的已存等级及完全没有元数据的路由。无需密钥的浏览器快照覆盖本地化 toggle 行和五个已声明等级；浏览器测试不会发出 provider 请求。
