const { app, BrowserWindow, dialog, ipcMain, shell, session } = require('electron')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const isPackaged = app.isPackaged
const sourceRoot = isPackaged ? path.join(process.resourcesPath, 'dsh-runtime') : path.resolve(__dirname, '../..')
const dataRoot = path.join(app.getPath('userData'), 'data')
const logPath = path.join(app.getPath('userData'), 'startup.log')
let runtime
let mainWindow
let runtimeOutput = ''

function findNode() {
  if (process.env.DSH_NODE_PATH) return process.env.DSH_NODE_PATH
  if (isPackaged) return path.join(process.resourcesPath, 'node.exe')
  return process.execPath
}

function startRuntime() {
  const cli = isPackaged ? path.join(sourceRoot, 'lib', 'bin.js') : path.join(sourceRoot, 'apps', 'cli', 'lib', 'bin.js')
  if (!fs.existsSync(cli)) throw new Error(`DSH CLI artifact not found: ${cli}`)
  const node = findNode()
  if (!fs.existsSync(node)) throw new Error(`Node runtime not found: ${node}`)
  fs.mkdirSync(dataRoot, { recursive: true })
  fs.appendFileSync(logPath, `[startup] node=${node} cli=${cli}\n`)
  const runtimeEnv = {
    ...process.env,
    DSH_DESKTOP_SHELL: '1',
    DSH_HOME: dataRoot,
  }
  runtime = spawn(node, [cli, '--profile', 'web', '--no-open', '--port', '0'], {
    cwd: sourceRoot,
    env: runtimeEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  return new Promise((resolve, reject) => {
    let output = ''
    const timeout = setTimeout(() => {
      reject(new Error(`DSH runtime did not become ready within 20 seconds.\n${output.slice(-4000)}`))
      runtime.kill()
    }, 20_000)
    const onLine = (chunk) => {
      output += chunk.toString()
      runtimeOutput = output.slice(-8000)
      fs.appendFileSync(logPath, chunk.toString())
      const match = output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/)
      if (match) {
        clearTimeout(timeout)
        resolve(match[1])
      }
    }
    runtime.stdout.on('data', onLine)
    runtime.stderr.on('data', (chunk) => { output = output.slice(-8000) + chunk.toString(); fs.appendFileSync(logPath, chunk.toString()) })
    runtime.once('error', (error) => { clearTimeout(timeout); reject(error) })
    runtime.once('exit', (code) => {
      clearTimeout(timeout)
      if (code !== 0) reject(new Error(`DSH runtime exited with code ${code}.\n${runtimeOutput}`))
    })
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
  try { await createWindow() } catch (error) {
    fs.appendFileSync(logPath, `\n[startup-error] ${String(error?.stack || error)}\n`)
    dialog.showErrorBox('DeepSeek Harness 启动失败', String(error?.stack || error))
    app.quit()
  }
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', () => { if (runtime && !runtime.killed) runtime.kill() })
