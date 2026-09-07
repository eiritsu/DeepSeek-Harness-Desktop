const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const packageRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(packageRoot, '..')
const runtimeRoot = path.join(packageRoot, '.runtime')
const nodeRuntimeRoot = path.join(packageRoot, 'node-runtime')
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

function copyWorkspacePackage(groupRoot, packageName) {
  for (const group of fs.readdirSync(groupRoot, { withFileTypes: true })) {
    if (!group.isDirectory()) continue
    const groupPath = path.join(groupRoot, group.name)
    const candidates = fs.existsSync(path.join(groupPath, 'package.json')) ? [groupPath] : fs.readdirSync(groupPath, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => path.join(groupPath, entry.name))
    for (const packagePath of candidates) {
      const manifestPath = path.join(packagePath, 'package.json')
      if (!fs.existsSync(manifestPath)) continue
      const name = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).name
      if (name !== packageName) continue
      const target = path.join(runtimeRoot, 'node_modules', ...name.split('/'))
      if (fs.existsSync(path.join(target, 'package.json'))) return
      fs.mkdirSync(target, { recursive: true })
      fs.copyFileSync(manifestPath, path.join(target, 'package.json'))
      const libPath = path.join(packagePath, 'lib')
      if (fs.existsSync(libPath)) fs.cpSync(libPath, path.join(target, 'lib'), { recursive: true })
      return
    }
  }
}

for (const packageName of [
  '@deepseek-ai/dsh-app-boot',
  '@deepseek-ai/cordis-plugin-group', '@deepseek-ai/cordis-plugin-include',
  '@deepseek-ai/cordis-plugin-loader', '@deepseek-ai/dsh-launch-environment',
  '@deepseek-ai/dsh-invariants', '@deepseek-ai/dsh-home-paths',
  '@deepseek-ai/dsh-system-prompt', '@deepseek-ai/cordis',
]) {
  copyWorkspacePackage(path.join(repoRoot, 'packages'), packageName)
  copyWorkspacePackage(path.join(repoRoot, 'vendor'), packageName)
}

if (process.platform === 'win32') {
  const nodeSource = process.env.DSH_NODE_PATH || 'C:\\Program Files\\nodejs\\node.exe'
  if (!fs.existsSync(nodeSource)) throw new Error(`Node runtime not found: ${nodeSource}`)
  fs.mkdirSync(nodeRuntimeRoot, { recursive: true })
  fs.copyFileSync(nodeSource, path.join(nodeRuntimeRoot, 'node.exe'))
}

function copyResolved(source, destination, active = new Set()) {
  const stat = fs.lstatSync(source)
  if (stat.isSymbolicLink()) {
    const resolved = fs.realpathSync(source)
    if (active.has(resolved)) return
    copyResolved(resolved, destination, new Set([...active, resolved]))
    return
  }
  if (stat.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true })
    for (const entry of fs.readdirSync(source)) {
      copyResolved(path.join(source, entry), path.join(destination, entry), active)
    }
    return
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.copyFileSync(source, destination)
}

function collectPnpmPackages(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const source = path.join(directory, entry.name)
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue
    if (entry.name === 'node_modules') {
      for (const dependency of fs.readdirSync(source)) {
        const dependencySource = path.join(source, dependency)
        if (dependency.startsWith('@')) {
          for (const scopedName of fs.readdirSync(dependencySource)) {
            const destination = path.join(flatModules, dependency, scopedName)
            if (!fs.existsSync(path.join(destination, 'package.json'))) copyResolved(path.join(dependencySource, scopedName), destination)
          }
        } else {
          const destination = path.join(flatModules, dependency)
          if (!fs.existsSync(path.join(destination, 'package.json'))) copyResolved(dependencySource, destination)
        }
      }
      continue
    }
    collectPnpmPackages(source)
  }
}

fs.mkdirSync(flatRuntimeRoot, { recursive: true })
for (const entry of fs.readdirSync(runtimeRoot)) {
  if (entry === 'node_modules') continue
  copyResolved(path.join(runtimeRoot, entry), path.join(flatRuntimeRoot, entry))
}
const sourceModules = path.join(runtimeRoot, 'node_modules')
const flatModules = path.join(flatRuntimeRoot, 'node_modules')
console.log(`Flattening runtime dependencies from ${sourceModules}`)
for (const entry of fs.readdirSync(sourceModules)) {
  if (entry === '.pnpm' || entry === '.bin') continue
  copyResolved(path.join(sourceModules, entry), path.join(flatModules, entry))
}
collectPnpmPackages(path.join(sourceModules, '.pnpm'))
console.log(`Flattened ${fs.readdirSync(flatModules).length} dependency entries`)
