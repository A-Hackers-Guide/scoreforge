const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs/promises')

function createWindow () {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 650,
    backgroundColor: '#101317',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false
    }
  })
  win.setMenuBarVisibility(false)
  win.loadFile('index.html')
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

ipcMain.handle('open-audio', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Open audio file',
    properties: ['openFile'],
    filters: [
      { name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'opus', 'webm'] }
    ]
  })
  if (canceled || !filePaths.length) return null
  const buf = await fs.readFile(filePaths[0])
  return {
    path: filePaths[0],
    name: path.basename(filePaths[0]),
    buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  }
})

ipcMain.handle('save-file', async (_evt, { defaultName, filters, data }) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Save',
    defaultPath: defaultName,
    filters
  })
  if (canceled || !filePath) return null
  const payload = data instanceof ArrayBuffer ? Buffer.from(data) :
                  ArrayBuffer.isView(data) ? Buffer.from(data.buffer, data.byteOffset, data.byteLength) :
                  typeof data === 'string' ? data :
                  Buffer.from(data)
  await fs.writeFile(filePath, payload)
  return filePath
})

ipcMain.handle('print-pdf', async (evt) => {
  const win = BrowserWindow.fromWebContents(evt.sender)
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Export sheet music to PDF',
    defaultPath: 'score.pdf',
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  })
  if (canceled || !filePath) return null
  const pdf = await win.webContents.printToPDF({
    pageSize: 'Letter',
    printBackground: true,
    margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 }
  })
  await fs.writeFile(filePath, pdf)
  return filePath
})
