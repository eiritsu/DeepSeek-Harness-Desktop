# Agent Note: 模型发现元数据由有序插件补充

Status: implemented

[English](2026-08-24-model-discovery-enrichment-plugins.md) | 中文

## 问题

[草稿端点询问](2026-08-04-draft-provider-endpoint-interrogation.zh.md)会保留端点明确返回的元数据，但很多 OpenAI 兼容网关只返回 id 与 `owned_by`。其上游模型 catalog 可能知道精确输入模态，而网关将其省略。把省略值当成纯文本会在请求构造前阻止图片；把每个省略值都当作支持图片则会虚构能力，并可能在提供方拒绝前持久化图片。现有的[逐路由模态声明](2026-08-12-pi-ai-route-default-input-modalities.zh.md)是准确的手工回退方法，但已安装 catalog 已有精确声明时不应重复填写。

提供方适配器不应吸收每个外部 catalog。否则通用端点询问会耦合无关的发布节奏，本地 catalog 增补也可能在适配器更新时被替换。

## 决策

`LlmRuntime` 提供有序、可释放的 `registerModelDiscoveryEnricher()` registry。enricher 接收已分离的归一化候选、原始草稿和对应 settings namespace。它只能为提供方已经发现的模型 id 返回元数据 patch。优先级依次为提供方明确字段、更早 enricher、较晚 enricher；任何注册项都不能增加模型或替换已有值。

运行时还提供有序的 `registerModelInputResolver()` 注册表，用于精确路由／模型查询。首个给出答案的解析器胜出，返回 `undefined` 则继续委托。除非逐模型 profile 显式固定 `input`，`llm-pi-ai` 都会查询该注册表，因此外部精确元数据可以补全已安装 catalog，而不只补 catalog 缺项。适配器会把声明与当前 wire protocol 已实现的序列化能力取交集，并把这份有效列表同时用于能力报告和不可变调用快照，因此准入与序列化不会产生分歧。

`LlmDiscoveredModel.ownedBy` 保留端点明确公布的 owner 标识。`@deepseek-ai/dsh-model-catalog` Profile Bundle 会在发现过程或运行时精确查询判断持久快照陈旧时刷新 `models.dev`，失败时保留 last-good 快照，并对动态数据不存在的 id 回退已安装 pi-ai catalog。可识别 owner 选择该提供方的精确动态条目；ownership 缺失或为网关自定义值时，要求动态条目对精确 id 达成共识。它会复制完整的 `text`、`image`、`audio`、`video` 与 `pdf` 输入声明；声明冲突或未知 id 保持不变，也不依据路由键、线路协议、显示名称或模型 id 模式推断。

随发行版提供的 Web profile 会在 `Deepseek-Files` 之后包含 catalog Bundle。Profile 规范化会在安装自有 Web 应用前缀之后补入任一缺失的默认 Bundle，同时保留第三方 Bundle 条目。catalog 仍是独立 Bundle，自定义 profile 可以通过常规 profile package 生命周期添加。采纳刷新候选后，仍会把补充过的逐模型 `input` 声明持久化进 settings；运行时查询则服务已有行而不改写它们。

## 备选方案

- **把 pi-ai 回退直接嵌入 `llm-pi-ai` discovery** —— 被否决，因为网关适配器会拥有一个独立于自身传输能力的补充 catalog，而且无法作为 profile 单元移除或升级。
- **根据模型 id、提供方路由或 `openai-responses` 推断视觉支持** —— 被否决，因为这些都不是能力声明，而混合模态路由很常见。
- **允许 enricher 替换端点元数据** —— 被否决，因为本地静态 catalog 不得覆盖部署明确给出的声明。
- **插件启动时自动修改已有 settings** —— 被否决，因为 discovery 是草稿操作，catalog 不应静默改写用户拥有的提供方配置。

## 影响

没有显式逐模型声明的已配置模型，只要默认 catalog 存在精确 owner 匹配或精确 id 共识，就会立即取得有效模态。Google 协议因为 pi-ai serializer 能输出任意 inline media，会在图片之外公开原生音频、视频和 PDF；OpenAI-compatible 协议仍限制为 `text/image`，并对其他媒体使用识别兜底。“获取模型”会为采纳流程公开完整声明，但已有行不需要改写。存在歧义的 id 继续采用路由的保守回退值。

核心 seam 是通用的，不含任何 pi-ai 或远程 catalog import。其他 catalog 可以按同一套只补缺规则发布独立 Profile Bundle，卸载某个 bundle 只撤回它自己的注册。动态新鲜度由配置的刷新间隔决定；持久 last-good 快照让发现流程在重启和 catalog 短暂故障后仍可使用。

## 测试

`packages/llm/llm/tests/topology.spec.ts` 固定两个注册表的顺序、只补缺优先级、未知 id 拒绝、分离与释放。`packages/llm/llm-pi-ai/tests/adapter.spec.ts` 固定已准备分发会使用外部解析的模态。`packages/llm/model-catalog/tests/catalog.spec.ts` 固定五种动态模态、精确 owner 选择、精确 id 共识、pi-ai 回退、冲突保留、释放与 Profile Bundle manifest。`packages/llm/model-catalog/tests/loader-composition.spec.ts` 通过真实 Loader 与 storage stack 启动该包，验证 A6 `openai-responses` 路由只公开协议实际支持的 `text/image`、Google 路由公开五种模态，并保留显式纯文本声明的最高优先级。`packages/boot/app-boot/tests/profile.spec.ts` 固定首次使用默认值，以及保留自定义 Bundle 条目的既有 Web profile 迁移。
