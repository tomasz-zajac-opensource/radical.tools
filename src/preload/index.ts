import { contextBridge, ipcRenderer } from 'electron'

// Expose a minimal safe API to renderer
const api = {
  platform: process.platform,
  send: (channel: string, ...args: unknown[]) => ipcRenderer.send(channel, ...args),
  on: (channel: string, listener: (...args: unknown[]) => void) => {
    ipcRenderer.on(channel, (_event, ...args) => listener(...args))
  },
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  saveDiagram: (json: string): Promise<{ success: boolean; filePath?: string }> =>
    ipcRenderer.invoke('dialog:save', json),
  openDiagram: (): Promise<{ success: boolean; filePath?: string; content?: string }> =>
    ipcRenderer.invoke('dialog:open'),
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electronAPI', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.electronAPI = api
}
