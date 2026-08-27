# Agent Note：刷新后的 catalog 拥有当前模型容量

状态：已实现

[English](2026-08-27-dynamic-model-capacity-resolution.md) | 中文

## 问题

提供方模型 catalog 独立发布。新模型可能先出现在 `models.dev`，随后已安装的 pi-ai 依赖才会描述它；采用到 settings 的模型行也可能保留发现当时正确、后来已经过时的容量。若把任一值永久视为权威，上下文压力、压缩阈值、溢出分类与提供方模型描述符都会保持陈旧，直到有人手工修改代码或 settings。

输出能力与请求输出默认值是两个不同的值。刷新模型最大输出容量不得静默新增或改变每次请求发送的 `maxTokens`。

## 决策

`LlmRuntime` 拥有有序且可 dispose 的 `registerModelCapacityResolver()` 注册表及对应的 `resolveModelCapacity()` 查询。解析器针对一条精确路由／模型身份返回正整数 `contextWindow`、`maxOutputTokens` 或两者。首个非空答案胜出；运行时校验并脱离内部引用后再返回。

`llm-pi-ai` 在准备不可变 adapter call 时，为每个已配置精确模型查询外部容量。返回值替换已物化 pi-ai 模型的上下文与输出能力，并用于元数据报告及提供方分发。它们不会进入 `configuredMaxTokens`；只有提供方 profile 显式写出的 `maxTokens` 仍会成为 `defaultMaxTokens` 请求上限。

`dsh-model-catalog` 把 `models.dev` 的提供方 API 端点、`limit.context` 与 `limit.output` 连同输入模态写入 last-good 快照。可识别 owner 选择其精确声明；owner 为本地别名时，由配置端点的精确匹配选择对应 catalog 提供方；否则每个字段独立要求同 id 共识，因此上下文不一致时，完全一致的输出容量仍可使用。动态数据缺失的字段回退到 pi-ai 已安装 catalog。持久化 payload 携带内部格式标记；旧缓存仍可读取，但会被视为一次性过期，使下一次按需查询用包含端点与容量的数据替换它，而无需改变 storage domain 版本。

发现 enrichment 仍然只补缺，因为端点响应是正在编辑草稿的权威信息。运行时容量解析代表当前 catalog 能力，可以替换陈旧的已安装或已保存值，但不改写 settings。

## 考虑过的替代方案

- **每次刷新后改写提供方 settings**：拒绝，因为 catalog 刷新会修改用户拥有的配置，并产生无关 settings 变更。
- **把已保存容量视为显式部署覆盖**：拒绝，因为模型页也会保存发现值，持久字段无法区分刻意设置的网关限制与旧 catalog 副本。
- **把 `limit.output` 映射到 `defaultMaxTokens`**：拒绝，因为模型硬能力不是部署选择的单次请求输出上限。
- **提升 storage domain 版本**：拒绝，因为缓存属于派生数据，旧 payload 在结构上仍可读取，格式标记即可请求一次安全刷新，避免仅为迁移引发 domain 加载失败。

## 影响

正常刷新间隔后的首次查询会让新模型容量生效。Web 上下文表、压缩、溢出处理与 pi-ai 分发共用同一个已解析上下文容量。catalog 暂时失败时会保留 last-good 数据及其容量。服务网关特有限制的运营方可以停用或替换可选 catalog Bundle；没有解析器作答时，核心 adapter 仍保留其配置与已安装回退值。

## 测试

核心测试覆盖解析器顺序、引用脱离、dispose 与无效容量。Adapter 测试证明刷新值会替换陈旧模型能力，同时显式请求默认值保持不变。Catalog 测试覆盖解析、精确 owner、精确端点与共识解析、旧缓存刷新、提供方及容量字段持久化和卸载行为。真实 Loader 组合会通过智谱 Coding Plan 端点，把已保存为 131,072 token 的 GLM-5.3-Flash 行解析为 1,000,000 token 上下文。Web 场景使用该精确运行时解析写入 `request/context`，并对界面可见的 `1M` 上下文表进行快照。
