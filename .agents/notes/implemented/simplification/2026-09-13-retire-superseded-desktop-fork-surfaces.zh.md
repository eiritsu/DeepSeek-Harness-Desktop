# Agent Note: 从 active build 退役已被替代的桌面分支界面

Status: implemented

[English](2026-09-13-retire-superseded-desktop-fork-surfaces.md) | 中文

## Problem

桌面分支与当前上游合并后，active tree 同时包含生产 Electron 应用，以及分支的 Swift 壳、早期 Windows 壳、旧 Client 兼容包、旧 LLM 目录适配器和过时 SQLite Session 后端。旧 package 引用了上游 Session、attachment、LLM、Web 与 Client 重构后已经移除的 API，导致仓库无法通过 typecheck。把这些文件继续放在 workspace 内，还会让 package discovery 与发行工具把未完成迁移的源码视为当前产品代码。

## Decision

Active build 只保留 `apps/desktop` 与 `apps/desktop-host` 中的上游 Electron 壳。已被替代的分支壳、兼容 package、旧 package artifact 及其过时 composition test 离开 workspace。依赖与第三方声明恢复为上游生产依赖图。

源码没有被丢弃：合并提交 `eaa77a8687` 的第一父提交包含完整桌面开发线，第二父提交包含完整上游开发线。[桌面分支 Electron 迁移提案](../../proposed/architecture/2026-09-13-desktop-fork-electron-migration.zh.md)记录了全部 23 组分支决策的去向，并列出 8 个必须通过当前 API 重新引入的独有领域；在这些工作完成前，Desktop 发行版不得宣称功能对等。开发 checkout 中已有的 Swift `.app` 与 `.dmg` 产物保持不变，并继续被忽略。

15 组行为已由上游 Electron、Session、attachment、LLM 或 Client 代码负责的 implemented Agent Note 转入冻结归档。另有 8 组记录继续保持 active，因为它们包含仍约束迁移的 Lark、SkillHub、external tools、文档提取、OCR 或旧数据恢复要求。

## Alternatives considered

**只从 TypeScript 排除旧 package，但继续让 workspace discovery 找到它们。** Package、文档、依赖与发行生成器仍会把它们当成当前代码，后续变更也可能意外发布未经验证的新旧运行时混合物。

**恢复被移除的上游 API，直到所有旧 package 都能编译。** 这会重新创建没有当前 consumer 设计的兼容界面，并让 Electron 迁移绑定到过时的 Session 与 Client 架构。

**删除分支历史，只保留复制出来的记录。** Agent Note 无法像 Git 父提交一样忠实保存可执行细节与来源。合并历史是权威恢复来源，迁移提案则是当前索引。

## Consequences

仓库重新只有一套 Desktop 架构，完整 Host 与 Client typecheck 也恢复通过。历史源码仍可从 `eaa77a8687^1` 恢复，但 Lark、SkillHub、external tools、Office/OCR 提取与旧数据库导入目前还没有进入 active application，不能宣传为已经保留的行为。每项功能只有在具备当前 composition test、snapshot、文档与 packaged Desktop 验证后才会重新加入。
