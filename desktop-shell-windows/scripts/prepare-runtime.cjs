const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const packageRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(packageRoot, '..')
const runtimeRoot = path.join(packageRoot, '.runtime')
fs.rmSync(runtimeRoot, { recursive: true, force: true })

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const result = spawnSync(pnpm, ['deploy', '--legacy', '--filter', '@deepseek-ai/dsh', '--prod', runtimeRoot], {
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
