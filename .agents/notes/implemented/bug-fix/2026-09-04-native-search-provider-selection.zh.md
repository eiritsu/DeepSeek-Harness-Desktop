# Agent Note：原生搜索提供方按凭据与优先级选择

状态：已实现

[English](2026-09-04-native-search-provider-selection.md) | 中文

## 问题

桌面组合同时挂载了 DeepSeek 原生搜索提供方和 external-tools 注册表。DeepSeek 适配器把异步解析器存在当成可用，因此添加 Tavily Key 后可能有多个原生搜索提供方同时可用。external-tools 注册表只把 Tavily、Brave Search 与 Exa 暴露为各自的模型工具。兼容 OpenAI 的网关还可能在 Responses `function_call_arguments.done` 事件中省略 `arguments`，导致解析器在任何 web 提供方执行前解引用 `undefined` 并崩溃。

## 决策

外部搜索适配器同时通过 `ctx.web` 和各自的专用工具注册。注册表根据保存的 `searchPriority` 选择一个已配置且已启用的搜索适配器，默认顺序为 Tavily、Brave Search、Exa。桌面 DeepSeek 适配器会根据已解析的凭据存在情况决定自动可用性；显式的非桌面组合保留原有解析器行为。锁定的 pi-ai 解析器在网关省略完成字段时保留已经拼接的函数参数，不再解引用 `undefined`。

## 验证

提供方聚焦测试覆盖 Tavily、Brave Search 与 Exa 的标准化响应、Tavily 请求头和重定向拒绝，以及未配置适配器不会被选中。现有 DeepSeek 提供方与 Loader 测试通过。修改包的 TypeScript Host 与 Client 检查通过。桌面冒烟测试必须使用重新构建的运行时，以确保修补后的依赖和提供方注册表一起发布。

## 考虑过的替代方案

**把每个已配置的搜索后端都注册到 `ctx.web`。** 拒绝，因为 web seam 正确拒绝依赖注册顺序的选择；当部署配置多个 API Key 时，应由保存的优先级表达产品选择。

**让模型改为选择 `tavily_search` 而不是 `web_search`。** 拒绝，因为这会复制原生搜索约定，并让提供方选择依赖提示词。原生 seam 应在模型看到结果前选择已配置的后端。

**把解析器函数存在当成提供方可用的证明。** 桌面组合拒绝此方案，因为解析器可能返回空值；在已配置外部后端旁边继续宣传该提供方可用，会在请求报告凭据缺失前造成歧义。

## 后果

原生 `web_search` 不再依赖模型选择 `tavily_search`，未配置 Key 时也不会发出请求。各提供方的专用工具仍可用于提供方特有操作。搜索优先级或接口地址变化会在下一次协调时生效；即使内置 DeepSeek 适配器也已挂载，WebRuntime override 仍会选择一个外部适配器。
