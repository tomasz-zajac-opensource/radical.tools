import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join, resolve } from 'path'
import { readFile, writeFile, watchFile, unwatchFile } from 'fs'
import { readFile as readFileAsync, writeFile as writeFileAsync } from 'fs/promises'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

// ── CLI-specified model file (--file /path/to/model.c4.json or RADICAL_FILE env) ──
function getWatchedFilePath(): string | null {
  const idx = process.argv.indexOf('--file')
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1]
  return process.env['RADICAL_FILE'] || null
}
const _watchedFilePath = getWatchedFilePath()

// Track when we last wrote to a path ourselves so we can suppress the
// "echo" watcher event that would otherwise reload the same content.
const _lastWrittenAt = new Map<string, number>()

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
            "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self' blob:; font-src 'self' data:"
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
    await writeFileAsync(result.filePath, json, 'utf-8')
    _lastWrittenAt.set(result.filePath, Date.now())
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
    const content = await readFileAsync(filePath, 'utf-8')
    return { success: true, filePath, content }
  })

  // ── IPC: silent file read/write (path already known) ─────────────────────

  ipcMain.handle('file:read', async (_event, filePath: string) => {
    try {
      const content = await readFileAsync(filePath, 'utf-8')
      return { success: true, content }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('file:write', async (_event, filePath: string, json: string) => {
    try {
      await writeFileAsync(filePath, json, 'utf-8')
      _lastWrittenAt.set(filePath, Date.now())
      return { success: true }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ── IPC: CLI-specified watched file ────────────────────────────────────────

  ipcMain.handle('file:getWatchedPath', () => _watchedFilePath)

  // ── DEV: sample model source file helpers ─────────────────────────────────
  // Path is resolved once in the main process — no Vite define needed.
  if (is.dev) {
    const SAMPLE_JSON = resolve(__dirname, '../../src/renderer/src/store/fintechSampleData.json')

    ipcMain.handle('dev:saveSample', async (_event, json: string) => {
      try {
        await writeFileAsync(SAMPLE_JSON, json, 'utf-8')
        return { success: true }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    })

    ipcMain.handle('dev:loadSample', async () => {
      try {
        const content = await readFileAsync(SAMPLE_JSON, 'utf-8')
        return { success: true, content }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    })
  }

  // ── File watcher: push external changes to renderer ───────────────────────
  // When launched with --file or RADICAL_FILE, watch the file with polling
  // (reliable on all mounts including /Volumes) and push its new content to
  // the renderer whenever it changes outside the app.
  if (_watchedFilePath) {
    watchFile(_watchedFilePath, { interval: 500 }, () => {
      // Suppress the echo caused by our own write (auto-persist → file:write IPC).
      const lastWrite = _lastWrittenAt.get(_watchedFilePath!) ?? 0
      if (Date.now() - lastWrite < 2000) return
      readFileAsync(_watchedFilePath!, 'utf-8')
        .then((content) => {
          const win = BrowserWindow.getAllWindows()[0]
          win?.webContents.send('file:external-change', { filePath: _watchedFilePath, content })
        })
        .catch((e) => console.warn('[main] watchFile read error:', e))
    })
    app.on('will-quit', () => unwatchFile(_watchedFilePath!))
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
