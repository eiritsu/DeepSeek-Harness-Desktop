# Agent Note: Fixed Web reasoning-effort vocabulary and Default semantics

Status: implemented

[English](2026-09-21-fixed-web-reasoning-effort-vocabulary.md) | 中文

## 问题

Web composer 的模型位与 `/model` 弹窗都从确切模型的适配器元数据（`reasoning.efforts`）派生推理强度选项。声明非标准等级词汇（例如 `standard` 或 `off`）的模型只显示这些名称；没有推理元数据的模型根本不显示 Effort 行；两个入口都会把元数据 `defaultEffort` 写进用户从未选择过的选择。因此同一个控件在不同模型间呈现不同等级，还可能提交一个元数据默认值，而不是让提供方自行决定的省略。

## 决策

两个 Web 入口为每个模型提供相同的固定七个等级，顺序为：Default、Minimal、Low、Medium、High、XHigh、Max。线上标识符是适配器自有的 id：`minimal`、`low`、`medium`、`high`、`xhigh`、`max`；Default 即不携带 `reasoningEffort`。适配器元数据绝不改变该列表——公布的等级名称与声明的 `defaultEffort` 均被忽略，没有推理元数据的模型仍显示全部七个等级。

只要持久状态未携带 `reasoningEffort`，选中项就是 Default；它绝不会被模型的元数据 `defaultEffort` 替换。两个入口的模型切换都只提交提供方与模型，因此绝不把目录默认值写入选择；重新选择当前路由会保留其已有的显式推理强度。菜单勾选显式推理强度，未设置时勾选 Default。

Host 是唯一的校验方。Web 层不会把固定词汇表与适配器公布的等级求交集；它提交用户所选的标识符，Host 拒绝的值通过提交入口现有的失败界面报告——composer 的临时 toast 或弹窗自身的错误。这些标识符始终是适配器自有的线上值；面向模型的 subagent 路由发现仍解析适配器公布的等级（[模型选择的 subagent 路由](2026-08-18-model-selected-subagent-routes.zh.md)）。

## 考虑过的替代方案

**保留适配器公布的等级与元数据默认值（现状）。** 拒绝：确切模型的词汇表会各不相同，没有元数据的模型完全失去 Effort 行，元数据默认值也会在用户未操作时进入选择。

**把固定词汇表与适配器公布的等级求交集。** 拒绝：公布列表只是建议性的，可能比路由实际接受的更窄，求交集会隐藏 Host 本会接受的等级，并重新引入按模型变化的差异。显式选择由 Host 校验。

**在客户端过滤或钳制不支持的等级。** 拒绝：静默改动用户选择会隐藏结果；拒绝应由 Host 负责，并由现有失败界面报告。

## 影响

Web 控件只有一套可预期的词汇表：七个标签固定在包词典中，Effort 行始终存在，菜单状态仅由 `reasoningEffort` 决定。声明非标准名称（例如 `standard`）的适配器失去其自定义 Web 标签，但线上值仍归适配器所有。持久选择现在只在用户挑选或 Host 默认设置时才携带 `reasoningEffort`，因此元数据 `defaultEffort` 不再改变请求。不支持的选项在 Host 处失败并以错误形式呈现，而不是从列表中消失。包 README 记录了同一份用户可见约定。
