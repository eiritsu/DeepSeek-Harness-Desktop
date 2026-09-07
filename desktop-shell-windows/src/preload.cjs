const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dshDesktopWindows', Object.freeze({
  pickDirectory: () => ipcRenderer.invoke('dsh.pick-directory'),
  openExternal: (url) => ipcRenderer.invoke('dsh.open-external', url),
  platform: 'win32',
}))

// Keep the platform bridge explicit. Web features can use this seam without
// depending on Electron globals or weakening context isolation.
window.addEventListener('DOMContentLoaded', () => {
  Object.defineProperty(window, 'dshDesktopPluginBridge', {
    configurable: false, enumerable: false, writable: false,
    value: Object.freeze({ request: async () => ({ ok: false, error: 'Windows plugin bridge is not available yet' }) }),
  })
})
