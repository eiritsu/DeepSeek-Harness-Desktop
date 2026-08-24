# @deepseek-ai/dsh-attachment

[English](README.md) | 中文

持久附件服务边界。`ctx.attachments` 以 `FileAttachmentRef` 按字节存储任意文件，并把经过校验的提供方无关规范化图片存为 `ImageAttachmentRef`；消费方绝不会在会话事件中持久保存浏览器路径、对象 URL、提供方 URL 或 base64。

`saveFiles` 在发布有序不可变引用前执行数量、单文件、总字节、媒体类型和规范 base64 准入。`readFile` 校验摘要、字节长度和元数据。受信任插件通过 effect 为通用文件与规范化图片注册 `FileRecognizer`；第一个支持该格式的识别器可以在 prompt 准入时返回有界文本。宿主会在模型可见前把文件文本记录进 `FileBlock`，把图片 OCR 文本记录进 `ImageBlock`。不支持或识别失败的通用文件只保留文件说明，不虚构内容；文本模型接收的新图片在识别没有返回文本时会被拒绝。

未发送的输入区图片仍是由浏览器持有的临时草稿。`validateImage` 运行完整准入策略但不执行持久化。`saveImages` 负责批次图片数量和总字节限制，在发布任何成员前准备全部规范化附件，然后按顺序提交，并且只在完整批次成功后返回引用。后续存储失败不会返回部分引用，但较早写入的不可变内容寻址对象可能保持不可达，直至具备按引用感知的垃圾回收。`AttachmentError.code` 使用封闭的 `AttachmentErrorCode` 字符串联合类型。其 `ImageAdmissionErrorCode` 子集标记可由调用方修正的图片输入失败；`isImageAdmissionError` 在运行时识别该子集，使每个协议适配器可以映射自己的错误词汇。`saveImage` 会在发布任何模型可见的会话事件前提交一张已接受的图片，并直接返回 `ImageAttachmentRef`。规范化过程缩小图片时，引用会通过 `originalDimensions` 记录应用方向后的输入尺寸。`readImage` 根据已记录的元数据校验规范化附件。`readImageRequest` 确定性派生路由所需的请求版本，其身份覆盖附件 ID、变换策略版本、像素和字节预算及编码参数。调用方通过 `Promise.all(refs.map(...))` 组合有序批次，本地实现仍通过实例级限流器、缓存和 singleflight 限制压缩并发。调用方可以取消读取和投影；实现保留取消结果，不把它转换为存储失败。

`admitEncodedImages(attachments, images)` 与 `admitEncodedFiles(attachments, files)` 是浏览器上传共用的 wire 入口。两者都先强制执行规范 base64，再把有序批量准入委托给服务。slash command 保持显式的仅图片附件声明；通用文件会被拒绝，不会静默丢弃。

## 模型体验

该包通过角色无关的 `ImageBlock` 与 `FileBlock` 间接影响模型。提供方适配器把图片解析为确定请求版本。当所选路由可以序列化确切模态时，LLM runtime 会保留 `audio`、`video` 与 `pdf` 文件；否则投影持久识别文本与元数据。图片同样选择原生输入或持久 OCR 文本。

#### KV 缓存影响

添加图片或文件会改变提供方请求，因此会使受影响的请求后缀失效。

## 已知限制与待完成工作

- 第一版仅接受 PNG、JPEG、WebP 和 GIF。
- 保留策略与垃圾回收尚未实现，因为恢复和 fork 后的会话可能共享不可变对象。
- 原生音频、视频与 PDF 传输取决于所选适配器协议；路由不能序列化该模态时，仍由 `Deepseek-Files` 识别回退。
- 持久的未发送草稿需要单独的生命周期契约。
