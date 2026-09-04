# Agent Note：发行运行时来源已固定并校验

状态：已实现

[English](2026-09-04-distribution-runtime-provenance.md) | 中文

## Problem

桌面发行包过去会把 Harness 和插件本地 checkout 中的文件与构建产物混合打包，而首次启动还会在解压后安装依赖。因此，只要本地 checkout 有脏文件或插件存在未跟踪文件，安装包中的源码、产物以及后续 GitHub 更新就可能无法对应同一个版本。

## Decision

发行打包要求 Harness 和插件 checkout 都没有未提交文件，并且各自的 HEAD 必须等于已发布的 `main` 引用。快照从已提交的 Git tree 复制，而不是从可变的 index 或工作区文件列表复制。归档内写入 `runtime-manifest.json`，记录 Harness commit、插件 commit、包版本，以及 CLI、Web、lockfile 和内置插件产物的 SHA-256 摘要。桌面壳在替换受管源码快照前校验该 manifest 和其中列出的每个产物。

## Alternatives considered

**继续复制本地工作区。** 不采用，因为未跟踪文件和独立构建的 `lib` 目录会让归档内容偏离用户能够获取和复现的提交。

**只信任应用 build number。** 不采用，因为时间戳只能标识一次安装尝试，不能证明归档包含哪个源码和产物。

**每次首次启动都从 GitHub 拉取。** 不采用，因为启动会依赖网络，还可能把新壳与不断变化的分支组合成不兼容的运行时。

## Consequences

未发布或有脏文件的 checkout 不能生成发行 DMG，被篡改或不完整的 bootstrap 归档会在激活前失败。封闭 runtime 迁移完成前，首次启动仍需安装依赖，但安装对象已经是固定且可审计的源码快照。manifest 为后续取消首次安装的完整 runtime closure 提供来源依据。
