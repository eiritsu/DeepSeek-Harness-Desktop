/** Typed preload operations exposed only by the Electron shell. */

import type { DesktopLocale } from './locale.ts'
import type { DesktopBackendState } from './backend-controller.ts'

/** IPC channel names kept private to the desktop application bundle. */
export const DESKTOP_IPC = {
  localeGet: 'dsh-desktop:locale-get',
  pluginLibraryRequest: 'dsh-desktop:plugin-library-request',
  pluginLibraryOpen: 'dsh-desktop:plugin-library-open',
  pluginsDisableAll: 'dsh-desktop:plugins-disable-all',
  backendStatus: 'dsh-desktop:backend-status',
  backendRetry: 'dsh-desktop:backend-retry',
  applicationRestart: 'dsh-desktop:application-restart',
  configurationReset: 'dsh-desktop:configuration-reset',
  sessionBackupExport: 'dsh-desktop:session-backup-export',
  sessionBackupImport: 'dsh-desktop:session-backup-import',
  sessionDataReset: 'dsh-desktop:session-data-reset',
  configurationBackupExport: 'dsh-desktop:configuration-backup-export',
  configurationBackupImport: 'dsh-desktop:configuration-backup-import',
  skillLibraryRequest: 'dsh-desktop:skill-library-request',
  backendState: 'dsh-desktop:backend-state',
  updatesCheck: 'dsh-desktop:updates-check',
  updatesInstall: 'dsh-desktop:updates-install',
  updatesState: 'dsh-desktop:updates-state',
} as const

/** Desktop release update state rendered by desktop-owned UI. */
export interface DesktopUpdateState {
  readonly phase: 'idle' | 'checking' | 'available' | 'installing' | 'ready' | 'error'
  readonly version?: string
  readonly message?: string
}

/** Narrow backend-application bridge for data and Skill operations. */
export interface DshDesktopApplicationApi {
  readonly protocolVersion: 1
  readonly data: {
    exportConfiguration(): Promise<{ path?: string }>
    importConfiguration(): Promise<{ imported: boolean }>
    exportBackup(): Promise<{ path?: string }>
    importBackup(): Promise<{ imported: boolean }>
    reset(): Promise<{ reset: boolean }>
  }
  readonly skills: {
    request(request: import('./skill-library.ts').DesktopSkillRequest): Promise<unknown>
  }
}

/** Startup-page controls, unavailable to backend-provided application documents. */
export interface DshDesktopStartupApi {
  readonly protocolVersion: 1
  locale(): Promise<DesktopLocale>
  readonly backend: {
    status(): Promise<DesktopBackendState>
    subscribe(listener: (state: DesktopBackendState) => void): () => void
  }
  disablePlugins(): Promise<void>
  restart(): Promise<void>
  resetConfiguration(): Promise<void>
}
