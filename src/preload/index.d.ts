export {}

declare global {
  interface Window {
    electronAPI: {
      platform: string
      send: (channel: string, ...args: unknown[]) => void
      on: (channel: string, listener: (...args: unknown[]) => void) => void
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
      saveDiagram: (json: string) => Promise<{ success: boolean; filePath?: string }>
      openDiagram: () => Promise<{ success: boolean; filePath?: string; content?: string }>
    }
  }
}
