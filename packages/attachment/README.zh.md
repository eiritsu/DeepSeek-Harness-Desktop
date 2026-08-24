# attachment/：持久附件能力族

[English](README.md) | 中文

持久二进制附件 seam、本地文件系统实现及可选识别 provider。

| 包 | 角色 | ctx 键 |
|---|---|---|
| `attachment/` | 不可变文件与图片引用、准入限制、存储服务和识别器注册表 | `ctx.attachments` |
| `attachment-local/` | `DSH_HOME` 下的私有内容寻址存储 | （注册至 `ctx.attachments`） |
| `file-recognizer-office/` | 可安装的有界文本、Office、OpenDocument 与 PDF 识别 Profile Bundle | （注册文件识别器） |

未发送的浏览器草稿刻意位于这项能力之外。只有用户提交提示词，或提供方适配器提交结构化模型输出时，字节才进入持久存储。
