# Agent Note: Prompt 接纳保留通用文件识别结果

Status: implemented

[English](2026-09-02-prompt-file-recognition.md) | 中文

## 问题

浏览器 prompt 会把通用文件接纳为持久引用，但创建用户消息时没有调用已挂载的附件 recognizer 获取提取文本。因此文件 recognizer 只有在其他调用方显式调用时才会工作，普通会话不会使用已配置的 Office、PDF 和 OCR 服务。

## 决策

`SessionCommandController.prompt()` 在构造持久 `UserMessage` 前识别每个已接纳的通用文件。结果保留在文件 block 的 `recognizedText` 中，因此 `projectFilesForModel()` 会把同一份提取文本投影到每个提供方请求，而会话日志同时保留源引用和文本。

## 曾考虑的替代方案

- **在每个提供方 adapter 中识别**——否决，因为这会重复识别，并可能使持久消息与模型请求不一致。
- **只在提供方不支持原生文件输入时识别**——否决，因为当前与提供方无关的消息路径会把通用文件投影为文本，也没有可靠的原生文件能力区分。

## 后果

已配置的附件 recognizer 会在普通 prompt 接纳过程中运行，识别失败继续使用现有 prompt 错误映射。Agent 接收消息前会承担识别延迟，之后的每个模型请求和回放都使用同一份持久识别结果。
