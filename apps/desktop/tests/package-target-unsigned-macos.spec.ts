import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  stages: [] as string[],
  keychain: vi.fn(async () => { throw new Error('signing keychain entered') }),
  notarizeArtifacts: vi.fn(async () => { throw new Error('notarization entered') }),
  notarizationProxy: vi.fn(async () => { throw new Error('notarization proxy entered') }),
  writeFile: vi.fn(),
}))

vi.mock('../scripts/desktop-package-environment.mjs', () => ({
  loadDesktopPackageEnvironment: () => ({
    DSH_DESKTOP_APP_ID: 'com.example.test',
    DSH_DESKTOP_AUTO_UPDATE_ENV: 'test',
    DOWNLOAD_TEST_ORIGIN: 'https://updates.example.com',
    DOWNLOAD_TEST_RELEASE_ID: '0123456789abcdef0123456789abcdef',
  }),
  validateDesktopPackageEnvironment: () => {},
}))
vi.mock('../scripts/desktop-toolchain-preflight.ts', () => ({ requireDesktopToolchain: async () => {} }))
vi.mock('../scripts/macos-signing-keychain.mjs', () => ({ withMacOSSigningKeychain: state.keychain }))
vi.mock('../scripts/package-macos.ts', () => ({ packageMacOSArtifacts: state.notarizeArtifacts }))
vi.mock('../scripts/notarize-macos.mjs', () => ({ notarizeMacOS: vi.fn(async () => {}) }))
vi.mock('../scripts/macos-notarization-proxy.ts', () => ({ withMacOSNotarizationProxy: state.notarizationProxy }))
vi.mock('node:fs', async importOriginal => ({
  ...await importOriginal<typeof import('node:fs')>(),
  writeFileSync: state.writeFile,
}))
vi.mock('../scripts/packaging-run.mjs', async (importOriginal) => {
  const original = await importOriginal<typeof import('../scripts/packaging-run.mjs')>()
  return {
    ...original,
    recordPackagingEvent: vi.fn(),
    createPackagingRun: () => ({
      directory: 'fixture-unsigned-run',
      finish: vi.fn(),
      run: async (stage: string) => { state.stages.push(stage) },
    }),
  }
})

it('keeps an unsigned macOS run out of signing, notarization, and release records', async () => {
  const savedPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!
  const savedArch = Object.getOwnPropertyDescriptor(process, 'arch')!
  const savedArgv = process.argv
  const savedExit = process.exitCode
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.stubEnv('npm_execpath', 'fixture-pnpm.cjs')
  try {
    state.stages.length = 0
    Object.defineProperty(process, 'platform', { ...savedPlatform, value: 'darwin' })
    Object.defineProperty(process, 'arch', { ...savedArch, value: 'arm64' })
    process.argv = [process.execPath, fileURLToPath(new URL('../scripts/package-target.ts', import.meta.url)), 'mac-arm64', '--unsigned']
    vi.resetModules()
    await import('../scripts/package-target.ts')
    expect(process.exitCode).toBeUndefined()
    expect(state.stages.filter(stage => stage.startsWith('exec electron-builder')))
      .toEqual(['exec electron-builder --config electron-builder.config.mjs --mac --arm64 --publish never'])
    expect(state.stages).toContain('exec tsx scripts/smoke-packaged-runtime.ts --unsigned')
    expect(state.keychain).not.toHaveBeenCalled()
    expect(state.notarizeArtifacts).not.toHaveBeenCalled()
    expect(state.notarizationProxy).not.toHaveBeenCalled()
    expect(state.writeFile).not.toHaveBeenCalled()
  } finally {
    Object.defineProperty(process, 'platform', savedPlatform)
    Object.defineProperty(process, 'arch', savedArch)
    process.argv = savedArgv
    process.exitCode = savedExit
    stdout.mockRestore()
    consoleLog.mockRestore()
    vi.unstubAllEnvs()
  }
})
