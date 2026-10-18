/**
 * Copy for the Archived sessions settings section. Simplified Chinese owns
 * the key set; English is checked complete against it, so a language switch
 * can never leave a Settings page half translated.
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'

/** Simplified Chinese dictionary and the section's key source of truth. */
export const zh = {
  'nav': '已归档',
  'title': '已归档',
  'description': '已归档的会话仍保留在这里，可以随时恢复或永久删除。',

  'search.placeholder': '搜索已归档会话',
  'search.label': '搜索已归档会话',
  'search.clear': '清空搜索',

  'workspace.all': '所有工作区',
  'workspace.filter': '按工作区筛选',
  'workspace.ungrouped': '未分组',

  'sort.label': '排序方式',
  'sort.updated': '按更新时间',
  'sort.created': '按创建时间',
  'sort.title': '按字母顺序',

  'summary.count': '共 {n} 项已归档会话',
  'summary.count.one': '共 {n} 项已归档会话',

  'empty.none': '还没有已归档的会话',
  'empty.filtered': '没有符合当前条件的已归档会话',
  'empty.pending': '正在读取已归档会话…',
  'error.title': '无法读取已归档会话',
  'error.detail': '与工作区的连接已中断，恢复连接前无法显示归档列表。',

  'group.expand': '展开 {name}',
  'group.collapse': '收起 {name}',

  'row.restore': '取消归档',
  'row.delete': '永久删除',

  'time.now': '刚刚',
  'time.minutes': '{n} 分钟',
  'time.hours': '{n} 小时',
  'time.days': '{n} 天',
  'time.months': '{n} 个月',
  'time.years': '{n} 年',

  'restore.failed': '无法取消归档该会话',
  'delete.failed': '无法删除该会话',

  'delete.title': '永久删除会话',
  'delete.description': '「{title}」的聊天记录将从磁盘中永久删除，无法恢复。',
  'delete.acknowledge': '我明白此操作不可撤销',
  'delete.confirm': '永久删除',

  'deleteAll.action': '永久删除当前 {n} 项',
  'deleteAll.action.one': '永久删除当前 {n} 项',
  'deleteAll.title': '永久删除全部已归档会话',
  'deleteAll.scope': '将永久删除当前筛选下的 {n} 项已归档会话（{scope}）：',
  'deleteAll.scope.one': '将永久删除当前筛选下的 {n} 项已归档会话（{scope}）：',
  'deleteAll.scope.all': '所有工作区',
  'deleteAll.scope.workspace': '工作区「{name}」',
  'deleteAll.scope.search': '搜索「{query}」的结果',
  'deleteAll.acknowledge': '我明白这 {n} 项会话将被永久删除且无法恢复',
  'deleteAll.acknowledge.one': '我明白这 {n} 项会话将被永久删除且无法恢复',
  'deleteAll.confirm': '永久删除 {n} 项',
  'deleteAll.confirm.one': '永久删除 {n} 项',
  'deleteAll.pending': '正在删除 {done}/{total}…',
  'deleteAll.partial': '已删除 {done} 项，{failed} 项删除失败。',

  'notice.restored': '已取消归档',
  'notice.deleted': '已永久删除',
  'notice.deletedMany': '已永久删除 {n} 项',
  'notice.deletedMany.one': '已永久删除 {n} 项',
} satisfies Record<string, string>

/** This section's dictionary key union. */
export type ArchivedSessionsLocaleKey = keyof typeof zh

/**
 * This section's translate function: its own dictionary keys plus the shared
 * common words (`cancel`, `close`, `retry`, `next`, `workspace.defaultName`).
 */
export type ArchivedTranslate = TranslateNS<'settings.archivedSessions'>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Archived sessions settings section copy. */
    'settings.archivedSessions': ArchivedSessionsLocaleKey
  }
}

/** English dictionary, checked complete against the Chinese key set. */
export const en = {
  'nav': 'Archived',
  'title': 'Archived',
  'description': 'Archived conversations stay here until you restore or permanently delete them.',

  'search.placeholder': 'Search archived conversations',
  'search.label': 'Search archived conversations',
  'search.clear': 'Clear search',

  'workspace.all': 'All workspaces',
  'workspace.filter': 'Filter by workspace',
  'workspace.ungrouped': 'No workspace',

  'sort.label': 'Sort by',
  'sort.updated': 'Last updated',
  'sort.created': 'Date created',
  'sort.title': 'Alphabetical',

  'summary.count': '{n} archived conversations',
  'summary.count.one': '{n} archived conversation',

  'empty.none': 'No archived conversations yet',
  'empty.filtered': 'No archived conversations match these filters',
  'empty.pending': 'Loading archived conversations…',
  'error.title': 'Could not load archived conversations',
  'error.detail': 'The workspace connection dropped, so the archived list stays unavailable until it reconnects.',

  'group.expand': 'Expand {name}',
  'group.collapse': 'Collapse {name}',

  'row.restore': 'Restore',
  'row.delete': 'Delete permanently',

  'time.now': 'now',
  'time.minutes': '{n}min',
  'time.hours': '{n}h',
  'time.days': '{n}d',
  'time.months': '{n}mo',
  'time.years': '{n}y',

  'restore.failed': 'Could not restore that conversation',
  'delete.failed': 'Could not delete that conversation',

  'delete.title': 'Delete conversation permanently',
  'delete.description': 'The conversation “{title}” will be permanently deleted from disk. This cannot be undone.',
  'delete.acknowledge': 'I understand this cannot be undone',
  'delete.confirm': 'Delete permanently',

  'deleteAll.action': 'Permanently delete all {n} conversations',
  'deleteAll.action.one': 'Permanently delete {n} conversation',
  'deleteAll.title': 'Permanently delete archived conversations',
  'deleteAll.scope': '{n} archived conversations in the current view ({scope}) will be permanently deleted:',
  'deleteAll.scope.one': '{n} archived conversation in the current view ({scope}) will be permanently deleted:',
  'deleteAll.scope.all': 'All workspaces',
  'deleteAll.scope.workspace': 'Workspace “{name}”',
  'deleteAll.scope.search': 'Results for “{query}”',
  'deleteAll.acknowledge': 'I understand these {n} conversations will be permanently deleted and cannot be recovered',
  'deleteAll.acknowledge.one': 'I understand this conversation will be permanently deleted and cannot be recovered',
  'deleteAll.confirm': 'Permanently delete {n} conversations',
  'deleteAll.confirm.one': 'Permanently delete {n} conversation',
  'deleteAll.pending': 'Deleting {done} of {total}…',
  'deleteAll.partial': 'Deleted {done}. {failed} could not be deleted.',

  'notice.restored': 'Conversation restored',
  'notice.deleted': 'Conversation deleted permanently',
  'notice.deletedMany': 'Permanently deleted {n} conversations',
  'notice.deletedMany.one': 'Permanently deleted {n} conversation',
} satisfies Record<ArchivedSessionsLocaleKey, string>
