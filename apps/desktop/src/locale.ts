/** Typed English and Chinese copy owned by the Electron shell. */

export const en = {
  application: 'Application',
  startupFailed: 'DeepSeek Harness could not start',
  startupLoading: 'Starting DeepSeek Harness…',
  startupLoadingDescription: 'Your workspace will open when it is ready.',
  startupErrorDescription: 'Choose a recovery action below. Disabling third-party plugins retains their files.',
  startupReinstallAdvice: 'If application files are missing or damaged, close the application and reinstall it. Your tasks are stored separately.',
  startupConfigurationAdvice: 'Reset Desktop deletes all Desktop profile configuration and third-party plugins without a backup, then starts a fresh profile. Shared tasks and settings are retained.',
  restartApplication: 'Close and restart',
  resetConfiguration: 'Reset Desktop and retry',
  disableThirdPartyPlugins: 'Disable all third-party plugins and retry',
  pluginsMenu: 'Desktop Plugins…',
  pluginsMenuPackagedOnly: 'Desktop Plugins… (available in packaged applications)',
  checkUpdatesMenu: 'Check for Updates…',
  updateCheckFailedTitle: 'Update Check Failed',
  unknownError: 'Unknown error',
  updateCheckTitle: 'Check for Updates',
  updateCurrent: 'You already have the latest version.',
  updateTitle: 'DeepSeek Harness Update',
  updateAvailable: 'An update is available',
  updateDetail: 'DeepSeek Harness {version}\n\nThis release includes its matching dsh version. The application will restart after installation.',
  installAndRestart: 'Install and Restart',
  later: 'Later',
  updateFailedTitle: 'Update Failed',
  sessionBackupExportTitle: 'Export Session database',
  sessionBackupImportTitle: 'Import Session database',
  sessionDataResetTitle: 'Clear local Sessions?',
  sessionDataResetMessage: 'This permanently removes the Desktop Session database. Export a backup first if you may need these tasks again.',
  sessionDataResetConfirm: 'Clear Sessions',
} as const

/** Every Desktop locale supplies the complete English key set. */
export type DesktopMessages = { readonly [Key in keyof typeof en]: string }

export const zh = {
  application: '应用',
  startupFailed: 'DeepSeek Harness 无法启动',
  startupLoading: '正在启动 DeepSeek Harness…',
  startupLoadingDescription: '准备就绪后将自动打开工作区。',
  startupErrorDescription: '请选择下方的恢复操作。禁用第三方插件会保留插件文件。',
  startupReinstallAdvice: '如果应用文件缺失或损坏，请关闭应用并重新安装。任务数据存储在独立位置。',
  startupConfigurationAdvice: '重置 Desktop 会删除桌面端的全部 profile 配置和第三方插件，不保留备份，然后重新初始化并启动。共享任务和设置会保留。',
  restartApplication: '关闭并重启',
  resetConfiguration: '重置 Desktop 并重试',
  disableThirdPartyPlugins: '禁用全部第三方插件并重试',
  pluginsMenu: '桌面插件…',
  pluginsMenuPackagedOnly: '桌面插件…（打包应用中可用）',
  checkUpdatesMenu: '检查更新…',
  updateCheckFailedTitle: '更新检查失败',
  unknownError: '未知错误',
  updateCheckTitle: '检查更新',
  updateCurrent: '当前已是最新版本。',
  updateTitle: 'DeepSeek Harness 更新',
  updateAvailable: '发现可用更新',
  updateDetail: 'DeepSeek Harness {version}\n\n新版本绑定匹配的 dsh，安装后将重新启动。',
  installAndRestart: '安装并重启',
  later: '稍后',
  updateFailedTitle: '更新失败',
  sessionBackupExportTitle: '导出 Session 数据库',
  sessionBackupImportTitle: '导入 Session 数据库',
  sessionDataResetTitle: '清空本地 Session？',
  sessionDataResetMessage: '这会永久删除桌面端 Session 数据库。如需保留这些任务，请先导出备份。',
  sessionDataResetConfirm: '清空 Session',
} as const satisfies DesktopMessages

/** Locale payload exposed to the Desktop-owned renderer. */
export interface DesktopLocale {
  readonly id: 'en' | 'zh-CN'
  readonly messages: DesktopMessages
}

/** Resolve Electron's locale to one shipped Desktop dictionary. */
export function resolveDesktopLocale(locale: string): DesktopLocale {
  return locale.toLowerCase().startsWith('zh')
    ? { id: 'zh-CN', messages: zh }
    : { id: 'en', messages: en }
}

/** Replace named placeholders in one locale-owned message. */
export function formatDesktopMessage(
  message: string,
  values: Readonly<Record<string, string>>,
): string {
  return message.replaceAll(/\{([^{}]+)\}/gu, (placeholder, key: string) => values[key] ?? placeholder)
}
