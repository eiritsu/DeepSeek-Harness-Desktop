// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openVerificationUrl } from '../src/client/external-link.ts'

describe('Lark verification navigation', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); Reflect.deleteProperty(window, 'dshDesktopPluginBridge') })

  it('uses the new window when the browser accepts it', () => {
    const open = vi.fn(() => ({}) as Window)
    const assign = vi.fn()
    openVerificationUrl('https://accounts.feishu.cn/oauth/v1/device/verify', {
      desktopBridgeAvailable: false,
      open,
      assign,
    })
    expect(open).toHaveBeenCalledOnce()
    expect(assign).not.toHaveBeenCalled()
  })

  it('falls back to the current tab when a normal browser blocks the popup', () => {
    const assign = vi.fn()
    openVerificationUrl('https://accounts.feishu.cn/oauth/v1/device/verify', {
      desktopBridgeAvailable: false,
      open: () => null,
      assign,
    })
    expect(assign).toHaveBeenCalledWith('https://accounts.feishu.cn/oauth/v1/device/verify')
  })

  it('lets the desktop navigation delegate handle a nil popup result', () => {
    const assign = vi.fn()
    openVerificationUrl('https://accounts.feishu.cn/oauth/v1/device/verify', {
      desktopBridgeAvailable: true,
      open: () => null,
      assign,
    })
    expect(assign).not.toHaveBeenCalled()
  })

  it('uses the current browser by default', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window)
    openVerificationUrl('https://accounts.larkoffice.com/oauth/v1/device/verify')
    expect(open).toHaveBeenCalledWith(
      'https://accounts.larkoffice.com/oauth/v1/device/verify',
      '_blank',
      'noopener,noreferrer',
    )
  })

  it('uses current-tab navigation when the current browser blocks a popup', () => {
    const assign = vi.fn()
    vi.stubGlobal('window', { open: vi.fn(() => null), location: { assign } })
    openVerificationUrl('https://accounts.feishu.cn/oauth/v1/device/verify')
    expect(assign).toHaveBeenCalledWith('https://accounts.feishu.cn/oauth/v1/device/verify')
  })
})
