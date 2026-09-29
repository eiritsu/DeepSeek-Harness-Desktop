/** `turnResend` namespace dictionaries for the edit-and-resend entry and card. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'action.label': '编辑并重发',
  'action.tip': '编辑这条消息并重新发送',
  'card.title': '编辑并重发',
  'card.warning.title': '这一回合运行过工具',
  'card.warning.tools': '重发会要求模型再次调用：{tools}。这些调用已经执行过，可能重复其外部副作用；历史日志会保留。',
  'card.cancel': '取消',
  'card.save': '重新发送',
  'card.saving': '正在发送…',
  'card.notAdmitted': '没有可替换的已完成回合，未写入任何内容。',
  'card.refused': 'Host 拒绝了这次重发（{refusal}）。没有内容到达模型。',
  'card.failed': '重发在记录后失败：{reason}。模型可能未被调用。',
  'card.pending': '重发意图已记录，但尚未开始任何尝试。',
  'card.uncertain': '请求已开始，但日志未记录模型是否被调用。结果未知；请勿再次发送同一操作。',
  'card.remoteFailed': '重发失败：{code}',
} satisfies Record<string, string>

/** The turnResend namespace key union. */
export type TurnResendKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'action.label': 'Edit and resend',
  'action.tip': 'Edit this message and send it again',
  'card.title': 'Edit and resend',
  'card.warning.title': 'This turn ran tools',
  'card.warning.tools': 'Resending asks the model to call again: {tools}. Those calls already ran and may repeat external side effects; the history log is kept.',
  'card.cancel': 'Cancel',
  'card.save': 'Send again',
  'card.saving': 'Sending…',
  'card.notAdmitted': 'There is no completed turn to replace, so nothing was written.',
  'card.refused': 'The Host declined this resend ({refusal}). Nothing reached the model.',
  'card.failed': 'The resend failed after it was recorded: {reason}. The model may not have been called.',
  'card.pending': 'The resend is recorded, but no attempt had started.',
  'card.uncertain': 'The request started, but the log does not record whether the model was called. The result is unknown; do not send this operation again.',
  'card.remoteFailed': 'The resend failed: {code}',
} satisfies Record<TurnResendKey, string>
