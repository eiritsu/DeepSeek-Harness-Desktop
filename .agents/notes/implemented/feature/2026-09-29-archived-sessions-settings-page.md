# Agent Note: Archived sessions settings page

Status: implemented

English | [中文](2026-09-29-archived-sessions-settings-page.zh.md)

## Problem

Archiving removes a Session from navigation but preserves its transcript, and until now the only place an archived Session could be recovered or removed again was the sidebar that archived it. Users who archived a batch have no list to review, no way to search it, and no way to free the storage of Sessions they no longer want. The archive set is registry-global, so a list has to be derived rather than read from one place.

## Decision

`@deepseek-ai/dsh-client-ui-settings-archived-sessions` registers one `settings.section` entry under the id `archived-sessions` at order 40, next to the icon branch `ui-settings-general`'s settings shell already reserves for that id. The page holds no archive state of its own: it reads `WorkspaceSnapshot` and `SessionListState` and issues `unarchiveSession` and `deleteSession` — the same commands the sidebar issues, so an archive, a restore, and a deletion here are the sidebar's operations rather than a second implementation of them.

The archive set is a registry-global `SessionId[]` with no `archivedAt` and no per-Session flag, so a row's group cannot come from it. `deriveArchivedRows` joins it with the Session list's `byId` for the title and timestamp and with `WorkspaceView.sessionIds` for the group; a Session held by several Workspaces keeps the first in Host order, which is the same account the sidebar's grouping derivation resolves. An archived id the Session list has not described is skipped rather than drawn blank.

`SessionListState` has no failure phase, so an unreachable Host leaves it `pending`. `archivedReadStatus` reports `pending` until both authorities have settled, so an empty archive observed during the first read is not presented as an archive that holds nothing; a broken Workspace follow stream is the only `failed` state, and the page offers no retry for it because the Workspace Controller owns reconnection and publishes no operation that resumes a terminal stream. A Workspace removed while chosen narrows the view to the unfiltered listing on the render its option disappears.

Rows leave the page through the controllers' own removal events, not an optimistic update, so a row whose follow stream has not arrived stays visible rather than vanishing before the Host has accepted the change.

The order selector offers update time, creation time, and title. The creation order reads the summary's `createdAt` and nothing else, and both the two orders' leading rows differ in the fixtures, so an implementation that reached for `updatedAt` fails the test rather than passing it. That field is optional on the Client summary because the Session list builds some rows itself — subagents the Host list does not carry — and those have no durable header. A missing creation moment cannot be placed on a timeline, so such a row follows every dated row instead of claiming the epoch or standing in for the moment with its update time; the order stays total through the same recency and Session id tie-breaks the other two use. One lookup names each order for both the dropdown row and the trigger's current value, so the two cannot disagree.

A row's two commands fade in on hover and on keyboard focus, inside `@media (hover: hover)` and nowhere else, because a touch device never fires the hover that would reveal them. A `@media (max-width: 560px)` rule gives the row two lines — the title on the first, the date and the commands on the second — because showing the commands at all times on touch leaves a one-line row too tight to hold all three. The two dropdown triggers take the `Input` primitive's box so the toolbar reads as one row of controls, and the page frame is the official Settings one. No rule in the page's stylesheet names a literal colour or a `font-family`; all of them are shared tokens.

Bulk deletion acts on the current view — the Workspace filter and the search query decide which Sessions it covers — but it freezes that view into a `DeleteArchivedScope` of session ids, a count, and a label when the first dialog opens, and the run deletes exactly those ids. A first dialog names that scope and the count, a second `RiskConfirmation` requires an acknowledgement, and the count on both steps and the set the run visits are the same set, so a filter or a stream change between the steps cannot widen a confirmed deletion. The dialog is mounted once per deletion rather than toggled, so each opening starts at the scope step with an unchecked acknowledgement.

Both deletion paths hold the same rules: a deletion the Host accepted closes its dialog, a refusal keeps it open with the acknowledgement cleared, and a command already issued keeps its dialog open and undismissable, because a dismissed dialog hides work that continues behind it. `RiskConfirmation`'s `cancelDisabled` is the single mechanism for that last rule — the cancel button, the close button, the page mask, and Escape all route through one dismissal guard. Deletions run one at a time; a run where some fail reports how many succeeded and how many did not, and does not retry.

## Alternatives considered

**A page-owned archive cache.** A second store of what is archived would drift from the registry and would make the sidebar and this page disagree about the same Sessions. The page derives its rows from the two snapshots on every read instead.

**Deleting everything in the archive.** The screenshot's control reads as a total deletion, but the archive is registry-global and its size is not visible before acting. Scoping the run to the current filter and naming that scope in the first dialog keeps the count and the effect the user confirms the same number.

**Re-reading the visible rows at confirm time.** Projecting the filters again when the run starts would let a filter change, or a session archived and listed by a stream update between the two dialogs, add rows the first confirmation never showed. Freezing the ids when the scope is named makes the confirmed set the deleted set, at the cost of a run that misses rows that appear after the dialog opened.

**Dismissing rows immediately after a command resolves.** The controllers publish the change that removes a row; an optimistic removal would hide a Session the Host has not actually deleted, which is the wrong direction to be wrong in for a destructive page.

**Reporting an unreachable Host as a failure.** The Session list cannot distinguish an unreachable Host from a first read in progress, so `pending` is the honest state and the Workspace stream is the only authority that can report `failed`.

**Dating a locally built row from its update time.** It would keep such a row in a placeable position and let the order be a plain number comparison, at the cost of filing a subagent under the moment it last ran — a fact the page already shows, which a reader of the creation order would misread as when the conversation began. The row has no creation moment, so it is listed last and says nothing about when it began.

**Treating a missing creation moment as the epoch.** The list would still be ordered, but a locally built row would lead the creation order as the oldest thing in the archive, which is as untrue as dating it from its update time and harder to notice.

## Consequences

The page adds no parallel state and no second command path, so a restore or deletion started here is visible to the sidebar and to every other Workspace feed through the same events. The projection in `archived-view.ts` is pure, so the page's list behavior — join, ownership, filtering, ordering, grouping, and read status — is tested without a Host.

Each order's total order falls back to the Session id, which is a counter rather than a time, so two Sessions can share a title and a timestamp and still order deterministically. The creation order leaves the rows the Session list built locally at the end, so a reader who wants the newest conversation first does not meet a subagent there. A bulk run is not resumable: a partial failure reports its counts and leaves the remaining Sessions archived, requiring the dialog to be reopened. A run that cannot be cancelled also cannot be stopped, and a dead Workspace stream hides the list until the Workspace Controller reconnects.

The page is browser-only and registers no model surface, so it changes no request, no Session event, and no snapshot output. Focused component and projection tests are its acceptance evidence; keyless recorded-session snapshots replay model-visible traffic and cannot represent a control-plane archive operation.
