# Agent Note: Enforce one desktop runtime per data directory

Status: implemented

[English](2026-08-26-desktop-runtime-single-writer.md) | 中文

## Problem

会话持久化协调器只在单个 Host 进程内串行化写入，JSONL backend 明确不提供跨进程写入排他。Launch Services 通常会重新激活已运行的 macOS 应用，但直接启动可执行文件或打开另一个应用副本可以绕过该行为。两个桌面 runtime 共用同一 Application Support 目录时，可能从不同持久化修订恢复同一会话，并追加相互重叠的序号区间。

## Decision

macOS 桌面壳在准备源码或启动 runtime 前，对 Application Support 目录中的 `runtime.lock` 获取非阻塞 advisory lock。应用在完整生命周期内保留打开的文件描述符，只在子 runtime 停止后释放，并在锁文件中记录 owner 进程标识。第二个桌面进程会激活该 owner，并在针对该目录启动另一个 Host 前自行退出。

该锁只负责打包桌面版的运行拓扑。CLI 进程和自定义 Host 仍需遵守持久化接口的单一 live writer 要求；与 App 同时运行时必须使用不同的数据根目录。

## Alternatives considered

**为所有持久化 backend 增加跨进程锁。** 这会改变受支持的部署拓扑，还需要为不同 backend 定义崩溃、遗留 owner 和跨平台语义。缺陷来自桌面壳针对同一桌面数据目录启动第二个 Host，因此排他责任属于桌面壳。

**终止已持有目录的进程。** 强制结束活跃 runtime 可能中断 turn 或持久化追加，还会让新启动的副本代替用户已在使用的应用。终止新进程可以保留现有 owner。

**仅依赖 Launch Services 的单实例行为。** Launch Services 不覆盖直接启动可执行文件或位于其他路径的应用副本，而这些正是需要保护的启动方式。

## Consequences

当两个桌面应用副本都包含该保护后，它们不能再并发修改同一份会话。重复启动会把已有 App 带到前台，不会遗留第二个启动窗口。由不具备该锁的旧构建升级时，必须先退出旧应用，再启动受保护的新构建。Swift 测试会持有第一个锁，验证第二个 owner 能报告第一个进程标识，释放后再验证能够重新获取。
