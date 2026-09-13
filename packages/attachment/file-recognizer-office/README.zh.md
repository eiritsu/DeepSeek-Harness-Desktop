---
description: "桌面附件的有界本地 Office 文档提取，以及可选 OCR、音频与视频识别。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-file-recognizer-office

[English](README.md) | 中文

## 概述

这个可安装的 Profile Bundle 为 UTF-8 纯文本与源码、Markdown、CSV/TSV、DOCX、XLSX、PPTX、ODT、ODS、ODP 和 PDF 附件注册有界语义提取。它还会安装一个 `Deepseek-Files` 设置页，用于配置可选的 OCR、音频转写和视频理解 endpoint。原文件仍是 durable source；提取文本经过上限裁剪并记录在所属 file 内容块中，使模型请求可以重建。

## 目录

- [需要的 Harness 底层扩展点](#required-harness-extension-points)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

通过桌面插件审查流程安装精确 npm 版本或固定 Git commit。安装过程禁用 lifecycle scripts。解析器作为受信任本地插件代码运行，并限制输入大小、ZIP 条目数、解压字节数、提取字符数、PDF 页数、单页像素数与渲染倍率。

每项远程能力分别配置 Model ID、API Base URL 或完整 Endpoint URL，以及托管 API key。以 `/v1` 或 `/api/v1` 结尾的 URL 会自动补充标准 `chat/completions` 或 `audio/transcriptions` 操作路径；其他 URL 保持原样请求。OCR 通过 OpenAI-compatible `image_url` 内容发送图片。无法在本机提取文字的 PDF 会先在本地逐页栅格化，再把受限制的每一页作为 PNG 图片发送，使只接受图片的 OCR endpoint 也能作为兜底。视频使用 `video_url`，音频使用 OpenAI-compatible Audio Transcriptions multipart 请求。API key 值由 credentials provider 分别保存在 `DEEPSEEK_FILES_OCR_API_KEY`、`DEEPSEEK_FILES_AUDIO_API_KEY` 和 `DEEPSEEK_FILES_VIDEO_API_KEY`；settings 只保存这些引用。Model ID 或 URL 为空时，对应远程能力关闭。Prompt 准入会按所选路由的有效模态决定每个媒体文件：原生 `image`、`audio`、`video` 或 `pdf` 会绕过对应识别器，不支持的模态则调用已配置回退并记录其文本。既没有原生传输、识别又没有产出内容时，不支持的音频、视频或 PDF 输入会被拒绝。

<a id="required-harness-extension-points"></a>
## 需要的 Harness 底层扩展点

这个 Bundle 可以独立打包，但不能安装到未修改的 DSH runtime。兼容的 Harness 版本必须已经提供以下主程序能力：

- `@deepseek-ai/dsh-attachment` 定义 `AttachmentRecognizer` 和 `AttachmentStore.registerRecognizer()`；Harness 源码中的所有者文件是 `packages/attachment/attachment/src/types.ts` 与 `packages/attachment/attachment/src/index.ts`。
- Session Controller prompt 准入会解析当前模型的有效输入模态，对模型不支持的媒体调用附件识别，并在请求对模型可见前把返回文本记录进 durable file 或 image 内容块；Harness 源码中的所有者集成位于 `packages/api/session-controller/src/commands.ts`。
- Host Credentials RPC 与客户端 Settings 插槽支持 write-only API key 和动态设置页。插件只把凭据引用写入 settings，浏览器不能读取已保存的 key 值。

侧载包只在这些扩展点上注册实现，不会自行增加扩展点、修改 agent loop、数据库或沙箱。缺少上述能力的 DSH 版本不兼容，必须先升级主程序；底层能力存在后，识别器和设置界面才可以通过这个 Bundle 独立更新。

该识别器声明 priority `100`。Harness 会先选择 priority 最高的识别器，同优先级再按 id 排序，因此安装其他文件插件后 OCR／解析器顺序仍然稳定。

<a id="model-experience"></a>
## 模型体验

### 已识别附件文本

#### 模型看到的内容

模型看到 durable 附件说明以及 prompt admission 时提取的有界纯文本。文本模型会用持久 OCR 文本代替新准入图片。无法支持或解析失败的通用文件只保留文件说明，不虚构内容。

##### 已识别文件示例

```markdown
[attached file: report.docx; application/vnd.openxmlformats-officedocument.wordprocessingml.document; 12345 bytes; attachment sha256:abcd1234]
Quarterly report
```

#### Token 影响

仅在识别成功时产生，并受 `maxExtractedChars` 限制。

#### KV Cache 影响

识别文本随用户消息追加，后续轮次保持稳定。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 旧版二进制 DOC、XLS、PPT、RTF 和 EPUB 文件可以保存和下载，但此 provider 不解析其内容。
- Provider 兼容性取决于具体协议。即使 endpoint 自称 OpenAI-compatible，也可能不支持 `image_url` 或 `video_url` 内容，因此需要按其文档确认能力。
- 识别过程会把受限制的媒体输入上传到配置的第三方 endpoint。扫描 PDF 上传受限制的逐页 PNG，而不是原始 PDF；Harness 沙箱不能约束该 provider 的保留或处理策略。

本包不发布运行时 invariant companion；识别结果在 recognizer 调用处完成验证，注册与释放行为由聚焦测试覆盖。

<a id="dev-note"></a>
### 开发备注

桌面 profile 会同时挂载本 recognizer 与 Client 设置包。模型路由的 modality 决策应保留在 Session Controller prompt admission 中，不应移入本 provider。
