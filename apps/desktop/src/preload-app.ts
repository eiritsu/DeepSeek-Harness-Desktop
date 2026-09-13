/** Startup controls for shell documents; application documents receive only the carrier marker. */

import { contextBridge, ipcRenderer } from 'electron'
import { DESKTOP_IPC, type DshDesktopApplicationApi, type DshDesktopStartupApi } from './ipc.ts'
import type { DesktopBackendState } from './backend-controller.ts'
import type { DesktopPluginBridge } from '@deepseek-ai/dsh-client-ui-plugin-library/client'

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
    exportConfiguration: () => ipcRenderer.invoke(DESKTOP_IPC.configurationBackupExport) as Promise<{ path?: string }>,
    importConfiguration: () => ipcRenderer.invoke(DESKTOP_IPC.configurationBackupImport) as Promise<{ imported: boolean }>,
    exportBackup: () => ipcRenderer.invoke(DESKTOP_IPC.sessionBackupExport) as Promise<{ path?: string }>,
    importBackup: () => ipcRenderer.invoke(DESKTOP_IPC.sessionBackupImport) as Promise<{ imported: boolean }>,
    reset: () => ipcRenderer.invoke(DESKTOP_IPC.sessionDataReset) as Promise<{ reset: boolean }>,
  },
  skills: {
    request: request => ipcRenderer.invoke(DESKTOP_IPC.skillLibraryRequest, request) as Promise<unknown>,
  },
}

const owned = location.protocol === 'dsh-app:'
const applicationDocument = owned && location.hostname === 'app'
contextBridge.exposeInMainWorld('dshDesktop', owned && location.hostname === 'shell'
  ? startup
  : applicationDocument ? application : { protocolVersion: 1 })
if (applicationDocument) {
  const plugins: DesktopPluginBridge = {
    request: request => ipcRenderer.invoke(DESKTOP_IPC.pluginLibraryRequest, request) as Promise<never>,
  }
  contextBridge.exposeInMainWorld('dshDesktopPluginBridge', plugins)
  ipcRenderer.on(DESKTOP_IPC.pluginLibraryOpen, () => {
    window.dispatchEvent(new Event('dsh:open-plugin-library'))
  })
}
