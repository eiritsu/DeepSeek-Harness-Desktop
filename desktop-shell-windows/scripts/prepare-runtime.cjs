const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const packageRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(packageRoot, '..')
const runtimeRoot = path.join(packageRoot, '.runtime')
const flatRuntimeRoot = path.join(packageRoot, '.runtime-flat')
fs.rmSync(runtimeRoot, { recursive: true, force: true })
fs.rmSync(flatRuntimeRoot, { recursive: true, force: true })

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const result = spawnSync(pnpm, ['deploy', '--legacy', '--filter', '@deepseek-ai/dsh', runtimeRoot], {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
if (result.error) {
  console.error(result.error)
  process.exit(1)
}
if (result.status !== 0) process.exit(result.status ?? 1)

const frontendDist = path.join(repoRoot, 'apps', 'web', 'dist')
const deployedFrontendDist = path.join(runtimeRoot, 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist')
fs.cpSync(frontendDist, deployedFrontendDist, { recursive: true })

function copyWorkspaceArtifacts(groupRoot) {
  for (const group of fs.readdirSync(groupRoot, { withFileTypes: true })) {
    if (!group.isDirectory()) continue
    const groupPath = path.join(groupRoot, group.name)
    const candidates = fs.existsSync(path.join(groupPath, 'package.json')) ? [groupPath] : fs.readdirSync(groupPath, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => path.join(groupPath, entry.name))
    for (const packagePath of candidates) {
      const manifestPath = path.join(packagePath, 'package.json')
      if (!fs.existsSync(manifestPath)) continue
      const name = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).name
      if (typeof name !== 'string') continue
      const target = path.join(runtimeRoot, 'node_modules', ...name.split('/'))
      if (fs.existsSync(path.join(target, 'package.json'))) continue
      fs.mkdirSync(target, { recursive: true })
      fs.copyFileSync(manifestPath, path.join(target, 'package.json'))
      const libPath = path.join(packagePath, 'lib')
      if (fs.existsSync(libPath)) fs.cpSync(libPath, path.join(target, 'lib'), { recursive: true })
    }
  }
}

copyWorkspaceArtifacts(path.join(repoRoot, 'packages'))
copyWorkspaceArtifacts(path.join(repoRoot, 'vendor'))

if (process.platform === 'win32') {
  const copy = spawnSync('robocopy', [runtimeRoot, flatRuntimeRoot, '/E', '/COPY:DAT', '/R:1', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS'], { stdio: 'inherit' })
  if (copy.error || (copy.status ?? 8) > 7) process.exit(copy.status ?? 1)
} else {
  fs.cpSync(runtimeRoot, flatRuntimeRoot, { recursive: true })
}
