// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/client/index.ts'
import { LarkManagementSection } from '../src/client/LarkManagementSection.tsx'

function surfacePromise(reject?: Error) {
  const dispose = vi.fn(async () => {})
  return Object.assign(reject === undefined ? Promise.resolve() : Promise.reject(reject), { dispose })
}

describe('ui-lark browser entry', () => {
  it('mounts and disposes the generated Remote and Settings surface', async () => {
    const disposeRemote = vi.fn(async () => {})
    const registerLocale = vi.fn(() => vi.fn())
    interface SlotOptions {
      label(): string
      inject(): unknown
    }
    const registerSlot = vi.fn((_options: SlotOptions, component: unknown) => {
      expect(component).toBe(LarkManagementSection)
      return vi.fn()
    })
    const slots = {
      inject: vi.fn((_name: string, register: () => unknown) => register()),
      register: registerSlot,
    }
    const surfaceCtx = {
      remote: { larkManagement: {} }, locale: { register: registerLocale, bind: () => () => 'Lark Management' },
      effect: (effect: () => unknown) => effect(), slots,
    }
    const surface = surfacePromise()
    const ctx = {
      remote: { $mount: vi.fn(async () => disposeRemote) },
      inject: vi.fn((_deps: readonly string[], callback: (value: typeof surfaceCtx) => void) => {
        callback(surfaceCtx)
        return surface
      }),
    }
    expect(inject).toEqual(['remote'])
    const dispose = await apply(ctx as never)
    const options = registerSlot.mock.calls[0]?.[0]
    expect(options?.label()).toBe('Lark Management')
    const face = options?.inject() as { controller?: unknown } | undefined
    expect(face?.controller).toBeDefined()
    await dispose()
    expect(surface.dispose).toHaveBeenCalledOnce()
    expect(disposeRemote).toHaveBeenCalledOnce()
  })

  it('rolls back the generated Remote when the dependent surface fails', async () => {
    const disposeRemote = vi.fn(async () => {})
    const surface = surfacePromise(new Error('missing slots'))
    const ctx = {
      remote: { $mount: vi.fn(async () => disposeRemote) },
      inject: vi.fn(() => surface),
    }
    await expect(apply(ctx as never)).rejects.toThrow('missing slots')
    expect(disposeRemote).toHaveBeenCalledOnce()
  })
})
