# Agent Note: A macOS shell for the Web profile

Status: implemented

English | [中文](2026-08-23-macos-desktop-shell.zh.md)

## Problem

The loopback `dsh web` application needs a browser window and a process owner. A desktop build needs native lifecycle, menu, navigation, update, and plugin-management behavior without creating a second client or moving Sessions, settings, profiles, approvals, and persistence out of the existing composition.

The official Web Host also exchanges a process-local launch token on the first root request. A native readiness probe that requests that URL before WKWebView would consume the one-time token without giving the browser its signed cookie. Source updates have a separate risk: replacing a diverged local desktop branch with `origin/master` would silently discard the very local functionality the application is meant to preserve.

## Decision

`desktop-shell/` is a macOS 13 Swift application that holds a single-instance lock for its Application Support root, starts the built CLI with `--profile web --no-open --port 0`, and embeds the announced loopback URL in WKWebView. The CLI readiness line is the normal startup commit point. The shell preserves the complete tokenized URL and gives its first request to WKWebView; after the browser exchanges the token under the [browser launch-token authentication decision](../architecture/2026-08-24-browser-token-authentication.md), reloads use the same authority with query and fragment removed. Update probes may request their isolated candidate URL because they discard that runtime after the HTTP check.

A document-start bridge stores only the opaque current-session selection in native preferences so random ports do not reset navigation. The native Edit menu follows the AppKit responder chain, external links leave the embedded page, and a transparent title bar reserves a drag region outside the sidebar. The application runs no server of its own and leaves the Web profile's tool sandbox, settings, approvals, and durable state unchanged.

The desktop shell injects a promise-returning plugin-management bridge into the loopback main frame. `dsh-client-ui-plugin-library` treats that bridge as a capability signal: it contributes one `sidebar.footer.action` entry and one `shell.overlay` entry only when the bridge exists. The native side pins network sources, validates the root manifest and `dsh.bundle.patch` target, issues a single-use 15-minute review token, delegates installation and removal to `dsh plugin --profile web`, and appends JSONL audit records. Exact saving and disabled dependency lifecycle scripts are installation precautions, not runtime confinement.

If one sideloaded Bundle prevents startup and the failing package is an out-of-tree Web profile dependency, the shell may retry once with a temporary profile that omits only that Bundle. The installed package and authoritative Web profile remain unchanged. Built-in or unattributed failures stay fatal.

Source updates accept only a fast-forward from the active source to the configured `origin` branch. A source that already contains the remote commit is current. Divergence fails loud and requires repository-level integration, so automatic update cannot replace local desktop commits. A permitted update is built in a detached worktree and started against separate probe data; only a successful launch-token exchange and HTTP 200 switch the active source pointer. The previous pointer remains available for rollback.

The Web composition supports both current plugins and the previous external-plugin generation. A client-runtime compatibility package forwards the old snapshot-store and settings imports to their current owners without creating duplicate client services. The attachment service keeps raster images as its only durable binary type while allowing trusted recognizers to convert transient generic-file bytes into logged text. LLM keeps exact-route metadata enrichment as the current API and also accepts effect-scoped discovery, input-modality, and capacity registrations from the previous catalog generation. The pi-ai adapter consumes both paths and filters request modalities to the current provider-neutral text/image vocabulary.

## Alternatives considered

**Probe the normal runtime URL before loading WKWebView.** Rejected because the probe consumes the process token, while its cookie stays in URLSession rather than WKWebView.

**Fast-forward directly to every fetched upstream commit.** Rejected because a diverged local branch would lose desktop behavior. The safe automatic case is ancestry-proven fast-forward; every other topology remains a repository integration task.

**Require every installed plugin to migrate before the desktop application can start.** Rejected because supported previous-version bundles already use public imports and registries that can be forwarded to one current owner. The compatibility surface is exact and additive: it does not restore ApiProxy, persist generic file bytes, duplicate slot registries, or let legacy audio/video modalities enter current model requests.

**Expose plugin mutation through a normal browser Remote.** Rejected because package-manager execution is desktop-only privileged behavior. A document-start, main-frame native bridge keeps the browser deployment unchanged.

## Consequences

The desktop application retains the official Web application and its current security model while adding native lifecycle and reviewed plugin management. First launch and reload authenticate correctly on random loopback ports. Automatic source updates preserve local changes by refusing divergence, at the cost of requiring manual integration whenever upstream and the desktop branch both advance.

Sideloaded plugins remain trusted local code. Structural review catches mutable or malformed sources and suppresses dependency lifecycle scripts, but it does not restrict runtime file, network, process, or credential access. The application remains ad-hoc signed and does not enable macOS App Sandbox because launching the CLI, Git, package manager, and agent subprocesses is required behavior.

Current and previous-version plugins can run in one Web profile. Durable images and adapter-owned model resolution remain authoritative; compatibility registrations only supply transient recognized text or fill missing exact-route metadata. The forwarding surface is deliberately limited to imports and registry behavior exercised by supported external plugins, so unrelated removed internals remain unsupported.
