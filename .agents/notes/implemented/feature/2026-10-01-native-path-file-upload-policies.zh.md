# Agent Note: Native-path file upload policies

Status: implemented

[English](2026-10-01-native-path-file-upload-policies.md) | 中文

## 问题

Desktop Host 能识别所选文件的本机路径，因此 composer 可以插入 `@` 引用，而无需读取或上传文件字节。部分文件消费方需要原始字节进行专有处理，其他带本机路径的文件则应继续使用引用流程。

## 决定

`ui-conversation` 向 Client 插件提供 `ctx.nativeFileUploadPolicies`。插件注册唯一 id 和一个检查原始浏览器 `File` 的 predicate；注册项以叠加方式组合，每个返回的 disposer 只移除自己的 predicate。`ui-conversation` 释放时会清空注册表。共享的 `addFiles` 入口只对有 Host 路径、且既不是目录也不是图片的文件查询注册表。匹配的文件进入现有通用文件上传栏。composer 文件选择器、粘贴处理器与附件拖放处理器都使用此入口。[通用文件上传](2026-08-26-generic-file-upload.zh.md)负责字节传输与持久化。

图片和没有 Host 路径的文件保持现有上传路径。目录继续使用目录引用处理，未匹配策略的本机路径文件仍作为 `@` 引用。

## 考虑过的替代方案

- **上传所有带本机路径的文件。** 拒绝：这会复制现有文件工具已经能通过宿主路径读取的文件，并移除 Desktop 上原有的引用入口。
- **分别在文件选择器、粘贴和拖放处理器中查询策略。** 拒绝：这些处理器原本就统一进入 `addFiles`；拆开分类会让同一文件因入口不同而有不同处理方式。
- **在 `ui-conversation` 中硬编码 Office MIME 类型或扩展名。** 拒绝：格式归需要原始字节的 Client 插件所有；predicate 可以直接检查原始 `File`，不必为 shell 增加格式目录。

## 后果

需要原始本机文件字节的 Client 插件为受支持的文件注册 predicate，并随自身贡献释放注册项。Shell 为其他本机路径文件保留引用行为，因此现有文件引用提供方可与上传消费方并存。

## 测试

注册表测试覆盖 predicate 叠加、重复和空 id、owner disposer 幂等、清空后的同名替换以及独立 owner。Conversation intake 测试覆盖策略匹配的 Office 与 PDF 上传、未匹配本机路径引用、策略之外的目录与图片处理、单项注册释放以及 Client 插件卸载时清空注册表。

## 相关记录

[通用文件上传](2026-08-26-generic-file-upload.zh.md)负责上传传输、暂存凭证与文件持久化。
