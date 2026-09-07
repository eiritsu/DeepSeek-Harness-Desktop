const { app, BrowserWindow, dialog, ipcMain, shell, session } = require('electron')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const isPackaged = app.isPackaged
const sourceRoot = isPackaged ? path.join(process.resourcesPath, 'dsh-runtime') : path.resolve(__dirname, '../..')
const dataRoot = path.join(app.getPath('userData'), 'data')
let runtime
let mainWindow

function findNode() { return process.env.DSH_NODE_PATH || process.execPath }

function startRuntime() {
  const cli = isPackaged ? path.join(sourceRoot, 'lib', 'bin.js') : path.join(sourceRoot, 'apps', 'cli', 'lib', 'bin.js')
  if (!fs.existsSync(cli)) throw new Error(`DSH CLI artifact not found: ${cli}`)
  fs.mkdirSync(dataRoot, { recursive: true })
  runtime = spawn(findNode(), [cli, '--profile', 'web', '--no-open', '--port', '0'], {
    cwd: sourceRoot,
    env: { ...process.env, DSH_DESKTOP_SHELL: '1', DSH_HOME: dataRoot },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  return new Promise((resolve, reject) => {
    let output = ''
    const onLine = (chunk) => {
      output += chunk.toString()
      const match = output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/)
      if (match) resolve(match[1])
    }
    runtime.stdout.on('data', onLine)
    runtime.stderr.on('data', (chunk) => { output = output.slice(-8000) + chunk.toString() })
    runtime.once('error', reject)
    runtime.once('exit', (code) => { if (code !== 0) reject(new Error(`DSH runtime exited with code ${code}`)) })
  })
}

async function createWindow() {
  const url = await startRuntime()
  mainWindow = new BrowserWindow({
    width: 1440, height: 920, minWidth: 1080, minHeight: 680,
    title: 'DeepSeek Harness',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true },
  })
  mainWindow.on('closed', () => { mainWindow = undefined })
  await mainWindow.loadURL(url)
}

ipcMain.handle('dsh.pick-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] })
  return result.canceled ? undefined : result.filePaths[0]
})
ipcMain.handle('dsh.open-external', async (_event, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) throw new Error('Only http(s) URLs may be opened')
  await shell.openExternal(url)
})

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => callback(permission === 'clipboard-read' || permission === 'clipboard-sanitized-write'))
  try { await createWindow() } catch (error) { dialog.showErrorBox('DeepSeek Harness 启动失败', String(error?.stack || error)); app.quit() }
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', () => { if (runtime && !runtime.killed) runtime.kill() })
