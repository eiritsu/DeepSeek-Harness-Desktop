# Agent Note: 规范 SkillHub 压缩包并校验目录请求

Status: implemented

[English](2026-09-03-skill-archive-and-catalog-request-validation.md) | 中文

## Problem

SkillHub 技能压缩包可以包含嵌套的 `references/` 和元数据文件。直接把压缩包条目复制到共享技能根目录，会让这些文件被当成独立安装，并使后续下载错误地报告“已存在”。SkillHub 插件接口当前只接受 `stars` 排序，而桌面界面曾暴露其他会返回 HTTP 400 的值。

## Decision

桌面安装器同时识别根目录和单层目录包装的 `SKILL.md`，忽略 SkillHub 的两种元数据文件名，先完整暂存内容，再原子移动到 `data/skills/<slug>`。已安装技能列表同时读取旧版根目录内容和规范化的子目录。插件发现请求及界面只暴露服务支持的 `stars` 排序，原生代码也会为旧客户端回退到该值。

发布打包脚本会拒绝不是 official profile 或产品名不是 DeepSeek Harness 的客户端构建记录。这样可以阻止本地开发版 Web 产物被嵌入发布 DMG。

## Alternatives considered

**下载前删除现有技能根目录。** 这会丢失用户数据，也不能修复后续压缩包布局缺陷。

**把每个压缩包条目复制到唯一的扁平前缀。** 前缀虽然能避免冲突，却会让运行时面对含义不清的技能布局，也无法保留压缩包内部的目录关系。

**保留不支持的插件排序并在 HTTP 400 后重试。** 重试相同的无效请求只会增加延迟，不会产生不同结果；现在的界面直接反映接口约定。

**信任调用方在打包前构建 official 产物。** 发布流程若接受过期的本地构建，就可能发布无法正常使用的应用，因此打包脚本现在校验记录中的 profile 和产品名。

## Consequences

新的 SkillHub 下载会把 `references/`、hooks 和其他内容目录保存在一个 slug 目录下。现有扁平安装仍可读取且不会被删除；重复 slug 会报告清晰的 slug 冲突。插件发现不再显示当前服务拒绝的排序控件，旧客户端也会得到安全的原生回退。Web 产物使用 local profile 时，发布打包会提前失败。

原生聚焦测试覆盖包装目录和仅含元数据的 Skill 压缩包，现有目录测试也会断言服务支持的排序值。下一份 DMG 必须在完整 official 客户端构建之后生成。
