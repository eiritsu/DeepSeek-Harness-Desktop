# Agent Note: 让插件卸载独立于发布年龄解析

Status: implemented

[English](2026-09-02-pnpm-remove-policy-bypass.md) | 中文

## Problem

启用 pnpm 默认的 `minimumReleaseAge` 策略时，桌面端插件库无法卸载已安装的 package。pnpm 11 会为只修改清单的卸载进入依赖解析，随后因为卸载路径没有提供它所要求的策略回调而以 `ERR_PNPM_RESOLUTION_POLICY_VIOLATIONS_UNHANDLED` 失败。

## Decision

桌面壳调用 `dsh plugin --profile web remove` 时传入 `--config.minimum-release-age=0`。卸载只删除已经选定的依赖并重新整理 profile 的 Bundle 列表，不会选择或安装新 package。因此仅对这次操作关闭发布年龄检查，避开 pnpm 的卸载内部错误，同时保留安装和更新操作的策略。

## Alternatives considered

**在 profile workspace 配置中关闭 `minimumReleaseAge`。** 放弃，因为这会同时削弱安装和更新的供应链策略，而不只是修复不需要选择新 package 的操作。

**直接编辑 `package.json`、`pnpm-lock.yaml` 和 `node_modules`。** 放弃，因为依赖图整理、lockfile 更新和 hoisted link 都由 pnpm 负责；在桌面壳中复制这些操作会产生第二套 package manager 实现。

**升级或固定到其他 pnpm 版本。** 放弃，因为打包桌面壳有意使用固定的 pnpm runtime，而当前失败局限于策略回调路径，并非特定 package 的不兼容。

## Consequences

即使配置了发布年龄策略，桌面插件库现在也能进入 pnpm 的正常 package 卸载和 Bundle 整理流程。所有可能引入或选择 package 版本的操作仍使用完整策略，profile lockfile 继续由 package manager 作为唯一事实来源。
