import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { signMacOSRuntime } from '../scripts/macos-runtime.ts'
import {
  signMacOSRuntimeAdHocCode,
  signMacOSRuntimeCode,
  verifyMacOSRuntimeAdHocCode,
  verifyMacOSRuntimeCode,
} from '../scripts/verify-macos-signature.mjs'

vi.mock('../scripts/verify-macos-signature.mjs', () => ({
  signMacOSRuntimeAdHocCode: vi.fn(),
  signMacOSRuntimeCode: vi.fn(),
  verifyMacOSRuntimeAdHocCode: vi.fn(),
  verifyMacOSRuntimeCode: vi.fn(),
}))
const roots: string[] = []
function root(): string {
  const path = mkdtempSync(join(tmpdir(), 'desktop-signing-'))
  roots.push(path)
  return path
}
const identity = { signingIdentity: 'Example (TEAMID1234)', teamId: 'TEAMID1234' }
afterEach(() => {
  vi.resetAllMocks()
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true })
})
it('signs Mach-O files in their final locations and verifies each signature', async () => {
  const path = root()
  writeFileSync(join(path, 'addon.node'), Buffer.from('cffaedfe00000000', 'hex'))
  writeFileSync(join(path, 'source.js'), 'export {}')
  await expect(signMacOSRuntime(path, 'com.example.app', identity)).resolves.toBe(1)
  expect(signMacOSRuntimeCode).toHaveBeenCalledWith(join(path, 'addon.node'), expect.stringMatching(/^com\.example\.app\.runtime\.[a-f0-9]{64}$/u), identity)
  expect(verifyMacOSRuntimeCode).toHaveBeenCalledWith(join(path, 'addon.node'), identity)
})
it('uses ad-hoc signatures only for the explicit local mode', async () => {
  const path = root()
  writeFileSync(join(path, 'addon.node'), Buffer.from('cffaedfe00000000', 'hex'))
  await expect(signMacOSRuntime(path, 'com.example.app', 'ad-hoc')).resolves.toBe(1)
  expect(signMacOSRuntimeAdHocCode).toHaveBeenCalledWith(
    join(path, 'addon.node'),
    expect.stringMatching(/^com\.example\.app\.runtime\.[a-f0-9]{64}$/u),
  )
  expect(verifyMacOSRuntimeAdHocCode).toHaveBeenCalledWith(join(path, 'addon.node'))
  expect(signMacOSRuntimeCode).not.toHaveBeenCalled()
})
it('awaits other signers before rejecting and permitting output cleanup', async () => {
  const path = root()
  for (const name of ['a.node', 'b.node']) writeFileSync(join(path, name), Buffer.from('cffaedfe00000000', 'hex'))
  let release!: () => void
  const barrier = new Promise<void>((resolve) => { release = resolve })
  let started!: () => void
  const ready = new Promise<void>((resolve) => { started = resolve })
  vi.mocked(signMacOSRuntimeCode).mockImplementation(async (file) => {
    if (file.endsWith('a.node')) throw new Error('sign failure')
    started()
    await barrier
  })
  let completed = false
  const result = signMacOSRuntime(path, 'com.example.app', identity).catch((error: unknown) => { completed = true; return error })
  try {
    await ready
    expect(completed).toBe(false)
  } finally { release() }
  expect(await result).toBeInstanceOf(AggregateError)
  expect(verifyMacOSRuntimeCode).toHaveBeenCalledWith(join(path, 'b.node'), identity)
})
