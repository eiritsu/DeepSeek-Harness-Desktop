# Agent Note: 通用文件附件与可侧载识别

Status: implemented

[English](2026-08-23-generic-file-attachments-and-recognition.md) | 中文

## 问题

Web 附件路径只准入四种光栅图片。浏览器输入区会在宿主能够存储或检查之前拒绝文档、压缩包、音频、视频、未知扩展名、目录和 macOS 应用 bundle。把所有 parser 加进核心会让格式支持与产品发布耦合，并让不受信任的压缩文档进入无界解析路径。

“支持所有文件类型”包含两项不同义务：不依赖格式 allowlist 地保存和传输任意字节；只有受信任的有界识别器理解格式时，才派生对模型有用的语义。把语义识别设为存储前提会继续拒绝未知格式，并让一次 parser 失败丢失用户文件。

## 决定

`ctx.attachments` 在规范化图片引用旁，把任意文件字节存为不可变 `FileAttachmentRef`。Web wire 接受通用 file block，宿主在追加用户事件前提交每个引用对象，历史记录渲染可下载文件卡片，会话导出包含原始字节，LLM runtime 把每个文件投影为提供方无关的元数据说明。空浏览器媒体类型变为 `application/octet-stream`；存储不受扩展名 allowlist 控制。

附件服务持有面向通用文件与规范化图片的 effect-scoped `FileRecognizer` 注册表。第一个支持该格式的识别器读取经过校验的持久对象，并可在 prompt 准入时返回有界文本。宿主会先解析所选路由的有效模态：受支持的图片、音频、视频与 PDF 保持原生输入，不受支持的媒体才调用识别器。文件文本记录在持久 `FileBlock`，图片 OCR 文本记录在持久 `ImageBlock`，后续请求不依赖重新运行可变 recognizer 代码。通用格式不受支持时保留文件说明且不虚构文本；新提交的图片、音频、视频或 PDF 若既无原生传输能力也无识别文本，会在用户消息持久化前被拒绝。

`@deepseek-ai/dsh-file-recognizer-office` 是可安装的 Profile Bundle，而不是核心 parser 依赖。它在输入大小、压缩条目、解压字节和提取字符限制下识别 UTF-8 文本与源码、Markdown、CSV/TSV、Office Open XML、OpenDocument 与 PDF。可选 OCR、音频转写和视频理解分别使用独立配置的 OpenAI-compatible endpoint。Model ID 与 API Base URL 或完整操作 URL 保存在插件 settings namespace；以 `/v1` 或 `/api/v1` 结尾的 base 会补充标准操作路径。API key 值通过固定引用留在 credentials provider，并在每次请求前即时解析。桌面插件审查把精确 npm 版本或固定 Git commit 安装进 DSH home profile，并禁用 lifecycle scripts。更新源码 checkout 不会替换该已安装依赖；预发布阶段仍不承诺核心与插件 API 兼容。

标准 Web profile 把该 Bundle 作为默认的 `Deepseek-Files` 插件。Bundle 同时插入自己的一级设置页，因此替换 Bundle 会一并替换其配置界面。Bundle 列表以安装方持有的 base 与 Web 行开头时，Web profile 会补入缺失的默认 Bundle，并保留其后已经安装的 Bundle。桌面插件库在“已安装”列表中展示内置 Bundle，从当前 package manifest 读取精确版本，并把它标记为不能通过外部依赖控制移除。

Add 启动器提供一个置顶、带回形针图标的“文件与文件夹”，并直接调用 picker。macOS 壳通过 WebKit open-panel delegate 提供一个可同时选择文件和目录的访达面板；普通浏览器保留文件输入与目录拖放路径。选中或拖入的目录会保留相对路径并归档为一个 ZIP。macOS `.app` bundle 因而变为 `<name>.app.zip`；浏览器传输不保留可执行权限、扩展属性或 code-signing 元数据。

这项决定扩展了[Web 多模态图片输入与持久附件](2026-07-22-web-multimodal-image-input-and-durable-attachments.zh.md)建立的持久生命周期，以及[动态客户端渲染与附件归属](../architecture/2026-08-17-dynamic-client-render-and-attachment-ownership.zh.md)建立的可选 UI 包。

## 备选方案

**把所有文档 parser 打包进附件核心。** 否决，因为存储必须保持格式中立，parser 依赖和漏洞独立演进，部署方也需要无需 fork 核心即可省略或替换识别器。

**未安装识别器时拒绝未知格式。** 否决，因为持久传输、下载、导出和如实的模型可见文件说明都不以识别为前提。

**把任意二进制 block 直接传给每个模型提供方。** 否决，因为提供方文件 API 和支持媒体各不相同。除非所选模型声明与适配器协议都实现精确模态，否则提供方无关投影使用确定性文本。Google 协议会把原生音频、视频和 PDF 序列化为 inline media；其他协议使用识别文本，且不改变持久文件归属。

**要求原生的文件与目录合并 picker。** 对 Web 产品否决，因为标准浏览器输入把文件与目录暴露为两种模式。原生 shell 可以在保持相同附件 wire 的前提下，用操作系统 picker 替换这层选择。

## 结果

每种文件格式都可以经过 Web 准入、持久存储、历史下载和导出路径，语义质量则取决于原生协议支持或已安装识别器与已配置 provider。具有精确 catalog 声明的 Google 路由直接接收音频、视频和 PDF 字节；其他路由使用持久识别文本，且不丢失原文件。压缩目录与文档处理受到限制，但解析受信任本地插件代码仍会扩大宿主依赖和安全面。远程识别会把完整且受大小限制的附件发送给所选 provider，其保留策略和格式支持不受 Harness 控制。目录 ZIP 转换保留层级但不保留完整文件系统元数据。文件仍受准入和逐请求 base64 限制；大媒体流式传输、逐文件进度、保留策略和按引用感知的垃圾回收仍是独立能力。
