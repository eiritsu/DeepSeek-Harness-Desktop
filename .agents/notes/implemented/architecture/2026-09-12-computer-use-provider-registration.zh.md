# Agent Note: Computer-use provider registration

Status: implemented

[English](2026-09-12-computer-use-provider-registration.md) | 中文

## Problem

桌面提供方暴露不同的操作、观测格式和平台设施。DSH 需要防止在一个组合中意外启用两个提供方，同时让各提供方的集成正常工作，而不承诺通用操作 API。

## Decision

DSH 能力称为 **computer use（计算机操作）**。[`dsh-computer-use`](../../../../packages/computer-use/computer-use/README.zh.md) 拥有 `ctx.computerUse`，注册一个提供方自定的名称并返回其 effect 清理函数。第二次注册无论名称为何都会失败。服务不包含提供方对象、共享操作类型、分派方法、Session 锁或运行时选择器。

**Cua Driver** 是上游实现的名称。[原生提供方](../../../../packages/computer-use/cua-driver-native/README.zh.md)是 release 包，安装上游原生 npm 依赖。[MCP 提供方](../../../../packages/experimental/computer-use-cua-driver-mcp/README.zh.md)连接已安装的可执行文件，保持实验性并加入显式公开发布允许列表。Desktop 与 Lite 产品默认挂载原生提供方；其他 profile 需显式选择提供方。

各集成暴露上游工具目录。MCP 结果转换保留在 `dsh-mcp-client` 中，其基于回调的工具适配函数也转换原生 Cua Driver 结果。计算机操作服务不依赖该适配函数或任一提供方。

提供方卸载时保留注册，直到停止接收工具调用且自有工作和资源关闭。分组 Cordis effect 为此清理排序；独立 effect 可能并发清理。原生提供方通过 `ctx.settings.installSection` 拥有持久化的 `enabled` 分区；由 [`dsh-client-ui-computer-use`](../../../../packages/client/ui-computer-use/README.zh.md) 贡献的一级**电脑操作**设置分区是该分区的用户层，组合配置中的 `enabled` 字段是基准层。浏览器半侧仅在组合提供该命名空间时注册该分区，因此它会在命名空间晚到时就绪，并在命名空间消失时撤回。切换它会重建挂载：关闭会中止进行中的调用、移除工具与指导文本、等待 SDK 关闭并释放注册名额，开启会重新导入原生代码、创建运行时并发现工具。一个串行化控制器为这些转换排序，因此停止总会先于它所取代的启动完成。并发 Session 由调用方协调，因为提供方注册不拥有观察、操作和验证流程。

## Alternatives considered

**统一操作 API。** 通用截图、输入和窗口术语需要转换提供方特有的语义，而当前没有需要可移植性的消费者。由提供方拥有工具可保留这些语义。

**仅外部 MCP。** 此方案复用已安装的驱动及其进程身份，但保留独立安装的前提。原生提供方提供单包运行时安装。

**仅嵌入原生运行时。** 原生集成让 DSH 拥有运行时生命周期，并与后端进程共享原生故障。MCP 提供方保留独立安装驱动的选项。

**Session 所有权代理。** 在完整流程期间预留桌面需要显式获取和释放策略。当前服务仅约束提供方注册，将流程协调留给调用方。

## Consequences

服务保持独立于实验性包。公开发布允许列表只接纳 MCP 提供方，但不提升其支持状态。配置选择提供方，切换需要先卸载当前提供方。原生提供方的 `enabled` 设置不切换提供方：它会释放并重新占用同一注册名额，因此挂载第二个提供方的组合仍会因名额被占用而失败。

Desktop 与 Lite bundle 在基础 bundle 的 `dsh-computer-use` 行之上挂载原生提供方；`dsh` 安装和 Desktop payload 在生产闭包中携带原生提供方。headless、web、ACP 与 SDK profile 都不选择提供方。[Desktop packaging smoke](../../../../apps/desktop/scripts/smoke-runtime.ts)在没有交互式桌面会话的情况下启动 Host，因此其 profile overlay 仅对该 smoke 禁用原生提供方；安装后的 Desktop 与 Lite 应用仍默认挂载提供方。workspace-constraints 门禁会拒绝任何 release 成员运行时依赖段引用实验性包。

原生平台支持和宿主权限仍由上游和部署负责。macOS 上由用户向启动应用授予桌面权限；Windows 需要交互式桌面会话。macOS 光标叠加层托管和专用 Desktop 权限界面暂缓实现。取消会停止等待并传播到驱动；不承诺回滚已交付的桌面输入。
