---
description: "Archived sessions settings section for the dsh web client: the Archived navigation entry, its workspace-grouped listing, and the restore and confirmed-deletion commands."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-archived-sessions

English | [中文](README.zh.md)

## Summary

Use the **Archived** settings section to review every archived session, grouped by the workspace that holds it. The page offers a search box, a workspace filter, and three sort orders — last updated, date created, and alphabetical; each row can be restored to the sidebar or permanently deleted, and a scoped bulk deletion is available once its scope is named and acknowledged twice. The page holds no archive state of its own: it reads the workspace snapshot and the session list, and issues the same unarchive and delete commands the sidebar does.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Open **Archived** in Settings. The toolbar narrows the list: the search box matches a case- and accent-insensitive substring of a session title, the workspace dropdown lists every workspace in the registry with the count of what it has archived, and the sort dropdown names what it orders by before naming the order in force. The three orders are last updated, date created, and alphabetical; a session the session list built locally — a subagent the host's list does not carry — has no durable creation time, so it follows every dated row in the creation order rather than being dated from its own update time. Collapsing a workspace group hides its rows without dropping the filter, so reopening it restores the same view.

Per row, the restore control calls the host's unarchive command and the delete control opens a confirmation that names the session; the destructive button stays disabled until its acknowledgement checkbox is ticked. Both row commands fade in on hover and on keyboard focus, and stay visible outright on a device that cannot hover. A narrow settings sheet gives the row two lines — the title on the first, the date and the commands on the second — so no cell is dropped or overlapped. A deletion the host accepts closes that confirmation — the row leaves through the controller's own event, and the page offers no second deletion of it. A deletion the host refuses keeps the confirmation open with the checkbox cleared, so the retry is a fresh acknowledgement and the refusal is reported. While a command is in flight the confirmation cannot be dismissed, because a closed dialog would hide work that is still running.

The bulk deletion acts on the current view only — the workspace filter and the search query decide which sessions it covers, and the first dialog states that scope and the count before the second dialog asks for its acknowledgement. That scope is frozen when the dialog opens: a filter that changes while it is up cannot widen what the confirmed run deletes, and the count on both steps keeps describing the same sessions. Deletions run one at a time, the dialog stays open and uncancellable for the whole run, and a run where some deletions fail reports how many succeeded and how many did not.

The page shares the official Settings page frame, the `Input` primitive's box for its two dropdown triggers, and the shared hover-reveal idiom: the row commands fade rather than unmount or hide, so they keep their width and stay focusable. In a narrow window, the Settings frame keeps its labeled navigation while giving the content column more width; the toolbar wraps its controls and the session rows put their title above the date and commands. Its stylesheet names no colour and no font of its own — every colour is a `--dsw-alias-*` token and every measurement is a floor or an ellipsis.

The page needs `dsh-client-ui-settings-archived-sessions` in the client composition. A composition that omits it shows no Archived navigation entry.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package registers one `settings.section` entry under the id `archived-sessions` at order 40, and its `inject` face binds the workspace snapshot source, the session list observable, and the two commands the page issues: unarchive one session and delete one session. The Host half is an empty `apply`, present only so the package holds a Loader row the client module system serves the browser half for.

The listing is a pure projection in `archived-view.ts`. `deriveArchivedRows` joins the registry-global `archivedSessionIds` with the session list's `byId` and the workspaces' `sessionIds`, so a row's title and timestamp come from the session controller while its group comes from the workspace controller; an archived id the session list has not described yet is skipped. `filterArchivedRows` applies the workspace choice and the search query, comparing both sides folded to NFD with the combining marks dropped, so a query typed without accents matches a title that carries them. `sortArchivedRows` orders by recency, by creation time, or by a case- and accent-insensitive collator, with recency and then the session id as the tie-breaks so each order is total; a row with no durable creation time follows every dated row in the creation order, because an unknown moment cannot be placed on the timeline. `groupArchivedRows` emits one group per workspace in registry order with the ungrouped remainder last. `archivedReadStatus` reports `pending` until both read authorities have settled, so an empty archive during the first read is not reported as an archive that holds nothing.

Local state is limited to what the Host does not own: the query, the chosen workspace, the sort, the collapsed group keys, the in-flight session ids, the two dialogs' open state, and the last notice. A workspace removed while chosen narrows the view to the unfiltered listing on the render its option disappears, so no control can name a filter the list no longer offers. The bulk dialog is mounted once per deletion rather than toggled open, so each opening starts at the scope step with an unchecked acknowledgement, and what it holds is a frozen set of session ids rather than a projection of the filters — the count both steps display and the set the run deletes are the same set. A command in flight holds its dialog open and undismissable, which the `RiskConfirmation` primitive's `cancelDisabled` applies to the cancel button, the close button, the page mask, and Escape at once. Row timestamps reuse the shared `relativeTime` buckets so the sidebar and this page name the same moment the same way; only the words come from this page's dictionary.

`archivedReadStatus` reports `failed` only for a Workspace stream that stopped for good, and the page then shows that failure instead of the list. It offers no retry: the Workspace Controller owns reconnection and publishes no operation that resumes a terminal stream, so a retry here could only re-read the Session list and would point the user at a reload that cannot help.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-settings](../ui-settings/README.md) — the domain base declaring `settings.section`.
- [ui-settings-shell](../ui-settings-shell/README.md) — the settings shell whose navigation renders the entry this package registers.
- [ui-workspace](../ui-workspace/README.md) — the sidebar over the same workspace snapshot and archive set.
- [workspace-controller](../../api/workspace-controller/README.md) — the archive set's transport and the unarchive and delete commands.
- [ui-primitives](../ui-primitives/README.md) — the menu, modal, risk confirmation, toast, and input primitives this page composes.

-----

<a id="model-experience"></a>
## Model Experience

None, as the page is a browser-side settings surface that registers no model surface.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Locally built rows have no creation time to sort by** — the session list builds some rows itself, a subagent the host's list does not carry, and they carry no durable header. They are listed last in the creation order rather than at the epoch or dated from their update time, and the page shows no creation time of their own.
- **Bulk deletion is sequential and unresumable** — a run that fails part way reports the counts but does not retry; the remaining sessions stay archived and the dialog must be reopened.
- **A restored or deleted row leaves by the controller's own event** — the page does not remove rows optimistically, so a run whose follow stream has not arrived keeps showing the row until it does.
- **A dead workspace stream hides the list** — the page shows the failure block instead of the last-known archive, and offers no way to resume; the Workspace Controller's reconnection is the only recovery.
- **Runtime invariant:** No companion is published. The page owns no relationship beyond the two snapshots and two commands it reads and issues.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The page reads two independent authorities, and the distinction is load-bearing: the workspace controller owns which sessions are archived and what they are called, the session controller owns their titles and timestamps. Keep the join in `archived-view.ts` pure and keep the failure classification in `archivedReadStatus`; the session list has no failure phase, so an unreachable host leaves it pending.

Both deletion paths go through a `RiskConfirmation`, the single one directly and the bulk one after a scope-naming step. Two rules hold for both: a deletion that the host accepted closes its dialog, and a command already issued keeps its dialog open, because a dismissed dialog hides work that continues behind it. The bulk scope must stay a frozen id set captured when the dialog opened — a projection of the current filters would let a filter change between the two steps delete sessions the first confirmation never showed.

Two styling rules are load-bearing and both are asserted against the stylesheet as text, because jsdom neither lays out nor evaluates a media query. A row's commands may only be hidden inside `@media (hover: hover)`: a touch device never fires the hover that would reveal them, so a rule outside that block strands them. A narrow sheet's rule must let the row wrap and give the title a full line, because making the commands permanently visible on touch leaves a one-line row too tight to hold a title, a date, and two commands. The same test rejects a literal colour or a `font-family` — the page reads the official tokens, it does not restate them.

A third rule governs the orders: the creation order reads `createdAt` and nothing else. Substituting a row's `updatedAt` for its missing creation time would file a subagent under the moment it last ran, which is a fact the page knows and a fact the reader would misread as when the conversation began. The fixtures keep the two orders' leaders on different rows, so an implementation that reaches for the wrong column fails the test rather than passing it.

</details>
