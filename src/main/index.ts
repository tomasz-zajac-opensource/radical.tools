import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join, resolve } from 'path'
import { readFile, writeFile } from 'fs/promises'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: false,
    titleBarStyle: 'default',
    title: 'Radical.Tools',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
    if (is.dev) mainWindow.webContents.openDevTools()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    // Apply CSP only in production (dev HMR needs inline scripts and eval)
    mainWindow.webContents.session.webRequest.onHeadersReceived((_details, callback) => {
      callback({
        responseHeaders: {
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src blob:; font-src 'self' data:"
          ]
        }
      })
    })
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.radical.diagram')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // ── IPC: native file dialogs ─────────────────────────────────────────────

  ipcMain.handle('dialog:save', async (_event, json: string) => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showSaveDialog(win!, {
      title: 'Save Diagram',
      defaultPath: 'diagram.c4.json',
      filters: [
        { name: 'C4 Diagram', extensions: ['c4.json'] },
        { name: 'JSON', extensions: ['json'] },
      ],
    })
    if (result.canceled || !result.filePath) return { success: false }
    await writeFile(result.filePath, json, 'utf-8')
    return { success: true, filePath: result.filePath }
  })

  ipcMain.handle('dialog:open', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(win!, {
      title: 'Open Diagram',
      filters: [
        { name: 'C4 Diagram', extensions: ['c4.json', 'json'] },
      ],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) return { success: false }
    const filePath = result.filePaths[0]
    const content = await readFile(filePath, 'utf-8')
    return { success: true, filePath, content }
  })

  // ── IPC: silent file read/write (path already known) ─────────────────────

  ipcMain.handle('file:read', async (_event, filePath: string) => {
    try {
      const content = await readFile(filePath, 'utf-8')
      return { success: true, content }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('file:write', async (_event, filePath: string, json: string) => {
    try {
      await writeFile(filePath, json, 'utf-8')
      return { success: true }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ── DEV: sample model source file helpers ─────────────────────────────────
  // Path is resolved once in the main process — no Vite define needed.
  if (is.dev) {
    const SAMPLE_JSON = resolve(__dirname, '../../src/renderer/src/store/fintechSampleData.json')

    ipcMain.handle('dev:saveSample', async (_event, json: string) => {
      try {
        await writeFile(SAMPLE_JSON, json, 'utf-8')
        return { success: true }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    })

    ipcMain.handle('dev:loadSample', async () => {
      try {
        const content = await readFile(SAMPLE_JSON, 'utf-8')
        return { success: true, content }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    })
  }

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
