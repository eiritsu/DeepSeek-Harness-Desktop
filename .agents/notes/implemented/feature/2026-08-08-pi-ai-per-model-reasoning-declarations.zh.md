# Agent Note: llm-pi-ai 的按模型推理声明

Status: implemented

[English](2026-08-08-pi-ai-per-model-reasoning-declarations.md) | 中文

## 问题

私有网关可以重命名推理值，也可能使用 pi-ai 无法从 URL 推断的协议方言。路由级 `reasoning` 只能选择默认值，无法描述逐模型协议拼写；若仅为更正一个拼写而替换已安装 catalog 模型，则不得不重述整条路由 catalog。

两个相邻的缺口让问题雪上加霜。pi-ai 靠识别端点 URL 来决定推理的*协议方言*（`compat.thinkingFormat`、`compat.supportsReasoningEffort`），而私有网关的 URL 什么也说明不了——说 DeepSeek 方言的网关只会收到 OpenAI 方言的请求，且没有任何配置能更正它。另外，想动单个 catalog 模型，唯一的手段是 `models` 列表，而它会*替换*所服务的 catalog：收窄 `gpt-5` 的档位，意味着要么重述全部三十八个 openai 模型，要么静默丢掉三十七个。

## 决策

`PiAiModelProfile` 携带 `reasoningEfforts`：每个键是一个 pi-ai 档位，值是分派时写入协议的拼写。声明会转换为 pi-ai 的 `Model.reasoning` 与 `thinkingLevelMap`；显式标准会话档位会保留已配置拼写，未声明的 `max` 则以规范值 `max` 尝试。`off` 是唯一的三态键：缺席或不赋值时交给 pi-ai 的协议特有禁用行为，赋值时该值进入协议。`false` 会让 Default 调用保留非推理描述符；空声明会被拒绝。「禁用」的拼写取 `false` 而非 `{}`，因为 schemastery 会把缺席的字典物化成 `{}`——只有 `z.union([z.const(false), dict])` 才能让缺席、禁用与已声明三态保持可区分；而裸写的 `reasoningEfforts:`（YAML null）会不经校验地从该 union 溜过去，因此解析对它显式拒绝。固定输入框选项由 [[2026-08-25-standard-reasoning-effort-controls]] 单独持有。

`compat.thinkingFormat` 与 `compat.supportsReasoningEffort` 变为两级可配置——路由级（作为其模型的默认值）与模型级（逐字段胜出）——解析顺序为模型 → 路由 → 已安装 catalog 条目 → pi-ai 按 URL 得出的猜测。`thinkingFormat` 经 `Record<UpstreamUnion, true>` 漂移门禁钉在 pi-ai 的联合类型上，因此新增格式的 pi-ai 升级会编译失败，直到新成员被归类（对照已发布的 0.84.1 tarball 验证过：其 `thinkingFormat` 联合类型相对钉住的 0.82.1 新增了 `baseten`）。`compat` 承载哪些字段、每个字段由哪些协议接受、以及无法读取的键如何被拒绝，归 [[2026-08-18-pi-ai-wire-compat-surface]] 所有；上面这条两级解析顺序正是该面所推广的东西。

`modelOverrides` 就地重塑单个 catalog 模型而不替换所服务的集合：键 = catalog 模型 id，值 = 去掉 `id` 的 `models` 条目，物化时把覆盖交给既有的条目路径，因此容量、档位、compat 与请求默认值语义完全一致。与忽略未知 id 的 Pi 自有配置层不同，凡是落不到任何地方的覆盖都会被拒绝——与 `models` 列表并存、写在手工声明的路由上、点名未知模型，或在值里夹带 `id`（schema 会放行未知键，被夹带的 id 会悄悄把模型改名）。

## 曾考虑的替代方案

- **把 `reasoning` + `thinkingLevelMap` 原样透传**（pi-ai 自家 radius 配置的形状）。用户以运维人员困惑为由否决：map 用 `null` 标记「不支持」的约定，加上不对称的键缺席规则，意味着这份配置的含义取决于对 pi-ai 内部机制的了解；选定的形状则让键集合本身就是对外提供的全部。
- **裸档位列表**（`reasoningEfforts: [off, high]`）。表达不了协议侧改名，而 catalog 自己的 map 证明改名真实存在：1230 条已安装 map 条目里有 66 条不是恒等映射（`off→none`、`minimal→low`、`low→LOW`、`high→default`）。
- **用 `{}` 作为禁用拼写。** 无法实现：schemastery 会把缺席的字典物化成 `{}`，于是每个没写该字段的模型都会被强制禁用。
- **把这件事并进路由级的 `reasoning` 旋钮。** 那个旋钮是默认选择，不是协议映射；它与逐模型拼写保持独立。
- **从云端能力 catalog 推导协议拼写。** 公共 catalog 无法知道私有网关的协议方言或别名，生成值也会与运维策略无法区分，因此未采用。

## 后果

- 私有网关无需提供方特有前端或 settings tab，即可翻译标准推理选择。
- `reasoningEfforts` 不会隐藏或增加输入框选项；不支持的选择会到达提供方，并可能在那里失败。
- 刻意不提供任何把单个 map 键或 compat 字段交还给「catalog 原本怎么说」的拼写：这份声明就是对外提供的全部，要保留某个 catalog 值就得重述它。README 记载了这一点。
- `verify-package-invariants` 原封未动：该功能新增的是配置解析，没有新事件，也没有可变的运行时关系。
