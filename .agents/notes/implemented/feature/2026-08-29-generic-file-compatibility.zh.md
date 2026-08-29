# Agent Note: Generic file compatibility

状态：已实现

[English](2026-08-29-generic-file-compatibility.md) | 中文

## Problem

附件重构保留了图片专用接收和临时识别，导致文档字节不会进入持久化会话内容，提交后模型也无法再次读取。没有模型目录推理元数据的供应商路由也失去了原有推理等级选择器。

## Decision

`AttachmentStore` 在图片路径旁保留通用文件限制、内容寻址的 `saveFile`/`readFile`，以及面向持久化识别器的输入。会话提示接收时保存文件引用，并在 `file` 内容块中记录有界识别文本。Provider adapter 将文件块投影为确定性文本，同时在附件存储中保留原始字节，使仅支持文本的模型也能处理文档。浏览器 composer 通过现有 draft id 路径接收非图片文件；图片继续使用预览和规范化流程。

没有供应商推理元数据的模型显示固定的 `off`、`low`、`high`、`max` 等级；供应商声明能力映射时仍按映射校验显式等级。

## Consequences

通用文件可以交给文档识别器，JSON 和源码文件按原字节持久化，同一会话重放时可以重建模型可见文本。命令 claim 仍只接受图片；普通提示提交同时携带图片和通用文件部分。

## Alternatives considered

**仅保留临时识别。** 这样会在会话边界丢失原始字节，也无法支持回放或后续消费者。

**把所有文件视为图片。** 文档会在图片解码阶段被拒绝，识别器也无法处理 office、文本和 JSON 格式。

## Verification

Harness 的 `pnpm run typecheck` 以及附件、conversation、UI attachment、pi-ai 定向测试通过。插件仓库的 `pnpm run build` 对文件识别器、Lark、model catalog、Deepseek-Files 包通过。
