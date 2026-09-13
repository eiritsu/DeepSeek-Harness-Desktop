---
description: "DeepSeek Files provider 设置，以及分离的桌面配置与 Session 数据维护控件。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-deepseek-files

[English](README.md) | 中文

## 概述

这个浏览器设置界面由 `Deepseek-Files` Profile Bundle 安装。它提供一个一级 `settings.section` 条目，在不修改 Settings shell 的情况下绑定 `file-recognizer-office` settings namespace，并显示当前 Swift 或 Electron bridge 支持的数据维护操作。

## 目录

- [设置与数据操作](#settings-and-data-operations)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="settings-and-data-operations"></a>
## 设置与数据操作

该页面分别编辑 OCR、音频转写和视频理解的 Model ID，以及 API Base URL 或完整 Endpoint URL。API key 值通过 credentials RPC 写入，不会进入 settings 文档；页面只能读取是否已配置和是否可写，不能恢复已有 key 值。

受支持的桌面 shell 还会获得独立的“桌面数据”区域。配置 archive 保持脱敏，并排除凭据、Session 正文和附件。Session 数据库导出/导入是针对已关闭权威 SQLite 文件的独立操作，文件明确包含会话正文。Swift shell 提供两类操作；Electron 当前提供 Session 数据库操作。两者在替换或重置 SQLite 前后都会停止并重启 Host。

<a id="model-experience"></a>
## 模型体验

### 识别设置

#### 模型看到的内容

本包不贡献模型文本。配置的 `dsh-file-recognizer-office` provider 负责产生并记录附件识别文本。

#### Token 影响

打开或编辑设置不会增加 token。识别文本具有 provider 包记录的有界 token 影响。

#### KV Cache 影响

无。配置的 provider 所产生的识别文本遵循 recognizer 包的有界附件投影。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 页面只配置协议 endpoint，保存前不会探测 provider 的具体能力。
- 只读 settings 或 credential source 仍会显示，但不能在此页面修改。
- Electron 尚未实现脱敏配置 archive parity；只有 Swift bridge 存在时，UI 才显示该操作。

本包不发布运行时 invariant companion；这个客户端设置投影不拥有持久事件流，也不拥有独立可变的跨插件关系。

<a id="dev-note"></a>
### 开发备注

配置 archive 与未脱敏 Session SQLite 备份必须保持为独立操作，并使用独立文案与 bridge 方法。
