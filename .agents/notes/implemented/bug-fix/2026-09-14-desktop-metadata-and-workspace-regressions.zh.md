# Agent Note：收口桌面端元数据与 Workspace 回归

状态：已实现

[English](2026-09-14-desktop-metadata-and-workspace-regressions.md) | 中文

## 问题

桌面端保留了动态模型目录，但 `llm-pi-ai` 不再为自定义路由消费其推理元数据。目录还要求同 ID 推理声明完全一致，因此多个上游路由只要拥有不同的附加强度，整个选择器就会消失。Session token 统计把提供方省略的缓存读取字段转成零，从而误显示“缓存命中 0%”。没有浏览器 deadline 的主机启动请求在传输停滞后会让“打开方式”按钮一直受 in-flight guard 限制。空 `conversationCwd` 的飞书会话继承桌面壳进程目录；应用或 checkout 移动后，Workspace 校验会隐藏旧分组，并把仍然存在的 Session 放进“未分组”。

## 决策

`llm-pi-ai` 只对 profile 未声明 `reasoningEfforts` 的模型查询 effect-scoped 推理 resolver，再把返回等级写入检查与 prepared call 共用的 pi-ai 描述符。models.dev parser 将 `none` 和 `toggle` 识别为规范 `off` 等级。没有 owner 的精确模型 ID 使用全部匹配声明的推理等级交集，在不合并提供方专属能力的前提下保留共同等级。缓存读取用量在持久投影中保持可选。只要一次参与调用未报告，聚合就会被标记为不完整，而不会把缺失值转成零。Chat 将已知正数读取统一标为“缓存命中”，计算它占全部计费输入的保守比例，并在详情弹层保留精确读取量；未报告缓存统计的调用仍计入未缓存输入，不会抬高该比例。

“打开方式”应用响应携带配置的客户端请求 deadline。浏览器在到期时中止启动，在 `finally` 中释放 in-flight guard，并在插件卸载时中止未完成启动。空 `conversationCwd` 的 Lark 与飞书改用 `$DSH_HOME/workspaces/lark`，桥接启动前创建该目录，并按品牌为新建 Workspace 命名。显式目录和持久 Session 目录保持不变。

## 考虑过的替代方案

**任意选择一个上游提供方声明。** 拒绝，因为没有 owner 或端点身份的自定义网关路由会获得实际后端未必支持的能力。

**继续把缺失缓存读取渲染成零。** 拒绝，因为零是提供方测量值，而字段缺失代表提供方没有给出缓存统计。

**自动把旧飞书 Session 移入新目录。** 拒绝，因为已发布 Session header 与 Workspace 成员关系是持久权威。恢复旧路径属于部署修复；新 Session 使用稳定默认目录，但不会重写历史数据。

## 结果

目录具备安全证据时，自定义模型重新显示上游推理控制，同时 profile 显式声明继续优先。token 总量包含已知输入、输出与缓存读取；缓存文案保持简洁，pill 显示保守命中率，弹层保留精确数值。停滞的本地启动传输会变成可恢复的点击失败。新飞书 Session 在应用升级后仍保持分组；现有 Session 继续从其已提交目录读取。

## 验证

专项测试覆盖推理解析与交集、adapter 消费与显式优先级、未知、部分确认与实测零缓存统计、启动超时恢复与卸载、带品牌名的 Workspace 创建、Tavily 原生提供方优先级、Office 识别兜底、附件拖放，以及 Electron 全平台共用的 Web 插件库桥接。类型检查、文档门禁、打包运行时审计和已安装应用 smoke 覆盖组装后的桌面 profile。
