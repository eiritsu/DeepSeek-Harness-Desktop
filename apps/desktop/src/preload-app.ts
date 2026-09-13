/** Startup controls for shell documents; application documents receive only the carrier marker. */

import { contextBridge, ipcRenderer } from 'electron'
import { DESKTOP_IPC, type DshDesktopApplicationApi, type DshDesktopStartupApi } from './ipc.ts'
import type { DesktopBackendState } from './backend-controller.ts'

const startup: DshDesktopStartupApi = {
  protocolVersion: 1,
  locale: () => ipcRenderer.invoke(DESKTOP_IPC.localeGet) as ReturnType<DshDesktopStartupApi['locale']>,
  backend: {
    status: () => ipcRenderer.invoke(DESKTOP_IPC.backendStatus) as ReturnType<DshDesktopStartupApi['backend']['status']>,
    subscribe(listener) {
      const handle = (_event: Electron.IpcRendererEvent, state: DesktopBackendState): void => { listener(state) }
      ipcRenderer.on(DESKTOP_IPC.backendState, handle)
      return () => { ipcRenderer.off(DESKTOP_IPC.backendState, handle) }
    },
  },
  disablePlugins: () => ipcRenderer.invoke(DESKTOP_IPC.pluginsDisableAll) as Promise<void>,
  restart: () => ipcRenderer.invoke(DESKTOP_IPC.applicationRestart) as Promise<void>,
  resetConfiguration: () => ipcRenderer.invoke(DESKTOP_IPC.configurationReset) as Promise<void>,
}

const application: DshDesktopApplicationApi = {
  protocolVersion: 1 as const,
  data: {
    exportBackup: () => ipcRenderer.invoke(DESKTOP_IPC.sessionBackupExport) as Promise<{ path?: string }>,
    importBackup: () => ipcRenderer.invoke(DESKTOP_IPC.sessionBackupImport) as Promise<{ imported: boolean }>,
    reset: () => ipcRenderer.invoke(DESKTOP_IPC.sessionDataReset) as Promise<{ reset: boolean }>,
  },
  skills: {
    request: request => ipcRenderer.invoke(DESKTOP_IPC.skillLibraryRequest, request) as Promise<unknown>,
  },
}

const owned = location.protocol === 'dsh-app:'
contextBridge.exposeInMainWorld('dshDesktop', owned && location.hostname === 'shell'
  ? startup
  : owned && location.hostname === 'app' ? application : { protocolVersion: 1 })
