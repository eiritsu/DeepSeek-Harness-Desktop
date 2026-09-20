/** `settings.computerUse` dictionary (the Computer Use settings section's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'computerUse.nav': '电脑操作',
  'computerUse.title': '电脑操作',
  'computerUse.description': '允许模型观察并操作本机桌面',
  'computerUse.toggle': '启用电脑操作',
  'computerUse.status.enabled': '已启用',
  'computerUse.status.disabled': '已停用',
} satisfies Record<string, string>

/** The settings.computerUse namespace key union. */
export type ComputerUseKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'computerUse.nav': 'Computer Use',
  'computerUse.title': 'Computer Use',
  'computerUse.description': 'Let models observe and operate the local desktop',
  'computerUse.toggle': 'Enable computer use',
  'computerUse.status.enabled': 'Enabled',
  'computerUse.status.disabled': 'Disabled',
} satisfies Record<ComputerUseKey, string>
