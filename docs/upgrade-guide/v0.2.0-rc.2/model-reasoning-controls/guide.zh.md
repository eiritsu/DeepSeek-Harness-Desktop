---
kind: upgrade-guide
description: "官方 DeepSeek 模型发现现在需要密钥，已保存的推理选项必须符合模型当前支持的控制方式。"
---

# 模型发现与推理选项遵循当前能力

[English](guide.md) | 中文

## 变更

从 v0.2.0-rc.2 升级后，`ctx.llm.listModels('deepseek-official')` 只有在 `DEEPSEEK_API_KEY` 可解析时才返回模型；否则选择器会隐藏该路由。没有密钥时直接请求仍以 `MISSING_CREDENTIAL` 失败。

推理菜单依据当前路由和模型元数据提供选项。MiniMax M3 提供 `on`/`off`（界面显示开启/关闭）；M3.1 Flash Preview 提供 `low`、`medium`、`high`、`xhigh`、`max` 五档；M2.7 不再显示等级选项。当前模型不支持的已存等级会标为不受支持，请求以 `UNSUPPORTED_REASONING_EFFORT` 失败，不会静默换级。`high` 仍受 M3.1 和原生 DeepSeek Messages 支持。原生 SDK budget、`reasoningEffort` 和 `maxTokens` 保持可用。

## 迁移

1. 集成若需官方模型列表，请先通过 credentials 服务或启动环境提供有效的 `DEEPSEEK_API_KEY`，再调用 `listModels()`。应用内可从**设置 → 模型**配置 official 提供商。只读环境密钥可以保留。
2. 对每个显示**推理等级不受支持**的 Session，打开当前模型的推理菜单并选 **Default** 或列出的值。**Default** 清除显式等级并使用模型或路由默认值。选择器会追加普通的模型选择事件，保留旧事件。确认不再显示不受支持提示。不要编辑或删除 Session 文件。
