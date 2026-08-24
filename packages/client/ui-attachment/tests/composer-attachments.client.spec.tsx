// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { strFromU8, unzipSync } from 'fflate'
import type {
  ComposerAttachment, ComposerAttachmentsProps,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ComposerAttachments } from '../src/client/ComposerAttachments.tsx'
import { ATTACHMENT_PICKER_EVENT } from '../src/client/events.ts'

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const t = ((key: string, params?: Readonly<Record<string, unknown>>): string => {
  const messages: Record<string, string> = {
    'image.pending': '待发送图片',
    'image.original': '原图',
    'image.preview': '原图预览',
    'image.closePreview': '关闭原图预览',
    'image.openOriginal': '查看原图',
    'image.scrollLeft': '向左滚动图片',
    'image.scrollRight': '向右滚动图片',
    'image.dropBlocked': '当前无法添加图片',
    'image.dropTitle': '图片拖动到此处即可添加',
    'file.pending': '待发送文件',
    'file.unknownType': '未知文件类型',
    'attachment.pickerTitle': '添加文件与文件夹',
    'attachment.pickFiles': '选择文件',
    'attachment.pickFolder': '选择文件夹',
    'attachment.pickerCancel': '取消',
    'attachment.pending': '待发送附件',
  }
  if (key === 'image.remove') {
    const name = params?.name
    return `移除图片 ${typeof name === 'string' ? name : ''}`
  }
  if (key === 'file.remove') {
    const name = params?.name
    return `移除文件 ${typeof name === 'string' ? name : ''}`
  }
  if (key === 'image.dropDesc') {
    const count = params?.count
    const size = params?.size
    return `最多 ${typeof count === 'number' ? String(count) : ''} 张，每张 ${typeof size === 'string' ? size : ''}`
  }
  if (key === 'attachment.dropDesc') {
    return `图片：最多 ${String(params?.imageCount)} 张，每张 ${String(params?.imageSize)}；文件：最多 ${String(params?.fileCount)} 个，每个 ${String(params?.fileSize)}`
  }
  return messages[key] ?? key
}) as ComposerAttachmentsProps['t']

function attachment(id: string, name = `${id}.png`): ComposerAttachment {
  return {
    kind: 'image',
    id: id as ComposerAttachment['id'],
    file: new File([Uint8Array.of(1)], name, { type: 'image/png' }),
    previewUrl: `blob:${id}`,
  }
}

function props(overrides: Partial<ComposerAttachmentsProps> = {}): ComposerAttachmentsProps {
  return {
    attachments: [],
    canAcceptDrop: true,
    onAddImages: () => {},
    onRemoveImage: () => {},
    t,
    ...overrides,
  } as unknown as ComposerAttachmentsProps
}

describe('ComposerAttachments', () => {
  it('accepts file drops anywhere on the document and keeps non-file drags native', async () => {
    const onAddImages = vi.fn<ComposerAttachmentsProps['onAddImages']>()
    const view = render(<ComposerAttachments {...props({
      onAddImages,
      dropLimits: {
        images: { count: 20, size: '5MB' },
        files: { count: 20, size: '32MB' },
      },
    })} />)

    expect(fireEvent.dragEnter(document.body, { dataTransfer: null })).toBe(true)
    const textTransfer = { types: ['text/plain'], files: [], dropEffect: 'none' }
    expect(fireEvent.dragEnter(document.body, { dataTransfer: textTransfer })).toBe(true)
    expect(fireEvent.dragOver(document.body, { dataTransfer: textTransfer })).toBe(true)
    expect(fireEvent.drop(document.body, { dataTransfer: textTransfer })).toBe(true)
    expect(view.queryByRole('status')).toBeNull()

    const image = attachment('dropped').file
    const dataTransfer = { types: ['Files'], files: [image], items: [], dropEffect: 'none' }
    expect(fireEvent.dragEnter(document.body, { dataTransfer })).toBe(false)
    expect(view.getByRole('status').textContent).toContain('图片拖动到此处即可添加')
    expect(view.getByRole('status').textContent).toContain('图片：最多 20 张，每张 5MB；文件：最多 20 个，每个 32MB')
    expect(fireEvent.dragOver(document.body, { dataTransfer })).toBe(false)
    expect(dataTransfer.dropEffect).toBe('copy')
    expect(fireEvent.drop(document.body, { dataTransfer })).toBe(false)
    await waitFor(() => { expect(onAddImages).toHaveBeenCalledWith([image]) })
    expect(view.queryByRole('status')).toBeNull()
  })

  it('archives a dropped .app directory as one generic ZIP attachment', async () => {
    const onAddImages = vi.fn<ComposerAttachmentsProps['onAddImages']>()
    render(<ComposerAttachments {...props({ onAddImages })} />)
    const info = new File([new TextEncoder().encode('bundle-id')], 'Info.plist')
    const fileEntry = {
      name: 'Info.plist', isDirectory: false, isFile: true,
      file: (resolve: (file: File) => void) => { resolve(info) },
    }
    let contentsRead = false
    const contents = {
      name: 'Contents', isDirectory: true, isFile: false,
      createReader: () => ({
        readEntries: (resolve: (entries: unknown[]) => void) => {
          resolve(contentsRead ? [] : (contentsRead = true, [fileEntry]))
        },
      }),
    }
    let appRead = false
    const app = {
      name: 'Demo.app', isDirectory: true, isFile: false,
      createReader: () => ({
        readEntries: (resolve: (entries: unknown[]) => void) => {
          resolve(appRead ? [] : (appRead = true, [contents]))
        },
      }),
    }
    const dataTransfer = {
      types: ['Files'], files: [], dropEffect: 'none',
      items: [{ kind: 'file', webkitGetAsEntry: () => app }],
    }
    fireEvent.drop(document.body, { dataTransfer })
    await waitFor(() => { expect(onAddImages).toHaveBeenCalledTimes(1) })
    const archived = onAddImages.mock.calls[0]?.[0][0]
    if (archived === undefined) throw new Error('directory archive missing')
    expect(archived.name).toBe('Demo.app.zip')
    expect(archived.type).toBe('application/zip')
    const entries = unzipSync(new Uint8Array(await archived.arrayBuffer()))
    expect(strFromU8(entries['Demo.app/Contents/Info.plist']!)).toBe('bundle-id')
  })

  it('opens the system picker directly and archives a selected directory', async () => {
    const onAddImages = vi.fn<ComposerAttachmentsProps['onAddImages']>()
    const view = render(<ComposerAttachments {...props({ sessionId: 'session-1' as never, onAddImages })} />)
    const fileInput = view.container.querySelector('input[type="file"]')
    if (!(fileInput instanceof HTMLInputElement)) throw new Error('file picker missing')
    const clicked = vi.fn()
    fileInput.addEventListener('click', clicked)
    window.dispatchEvent(new CustomEvent(ATTACHMENT_PICKER_EVENT, { detail: { sessionId: 'session-1' } }))

    expect(clicked).toHaveBeenCalledOnce()
    expect(view.queryByRole('dialog')).toBeNull()
    const file = new File([new TextEncoder().encode('bundle-id')], 'Info.plist')
    Object.defineProperty(file, 'webkitRelativePath', { value: 'Demo.app/Contents/Info.plist' })
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => { expect(onAddImages).toHaveBeenCalledTimes(1) })
    const archived = onAddImages.mock.calls[0]?.[0][0]
    if (archived === undefined) throw new Error('directory archive missing')
    expect(archived.name).toBe('Demo.app.zip')
    const entries = unzipSync(new Uint8Array(await archived.arrayBuffer()))
    expect(strFromU8(entries['Demo.app/Contents/Info.plist']!)).toBe('bundle-id')
  })

  it('tracks nested file drags and clears an aborted drag', () => {
    const view = render(<ComposerAttachments {...props()} />)
    const dataTransfer = { types: ['Files'], files: [], items: [], dropEffect: 'none' }
    fireEvent.dragLeave(document.body, {
      dataTransfer: { types: ['text/plain'], files: [], dropEffect: 'none' },
    })
    fireEvent.dragEnter(document.body, { dataTransfer })
    fireEvent.dragEnter(document.body, { dataTransfer })
    fireEvent.dragLeave(document.body, { dataTransfer, clientX: 5, clientY: 5 })
    expect(view.getByRole('status')).toBeTruthy()
    fireEvent.dragLeave(document.body, { dataTransfer, clientX: 5, clientY: 5 })
    expect(view.queryByRole('status')).toBeNull()
    fireEvent.dragEnter(document.documentElement, { dataTransfer })
    const leftViewport = new Event('dragleave', { bubbles: true, cancelable: true })
    Object.defineProperties(leftViewport, {
      dataTransfer: { value: dataTransfer },
      clientX: { value: -1 },
      clientY: { value: 5 },
    })
    fireEvent(document.documentElement, leftViewport)
    expect(view.queryByRole('status')).toBeNull()
    fireEvent.dragEnter(document.body, { dataTransfer })
    fireEvent.dragEnd(window, { dataTransfer })
    expect(view.queryByRole('status')).toBeNull()
  })

  it('shows a blocked drop without forwarding its files', () => {
    const onAddImages = vi.fn<ComposerAttachmentsProps['onAddImages']>()
    const view = render(<ComposerAttachments {...props({ canAcceptDrop: false, onAddImages })} />)
    const image = attachment('blocked').file
    const dataTransfer = { types: ['Files'], files: [image], items: [], dropEffect: 'copy' }
    fireEvent.dragEnter(document.body, { dataTransfer })
    expect(view.getByRole('status').textContent).toBe('当前无法添加图片')
    fireEvent.dragOver(document.body, { dataTransfer })
    expect(dataTransfer.dropEffect).toBe('none')
    fireEvent.drop(document.body, { dataTransfer })
    expect(onAddImages).not.toHaveBeenCalled()
    expect(view.queryByRole('status')).toBeNull()
  })

  it('routes rail removal and closes previews on Escape or attachment removal', () => {
    const onRemoveImage = vi.fn()
    const image = attachment('draft-1', 'pixel.png')
    const initial = props({ attachments: [image], onRemoveImage })
    const view = render(<ComposerAttachments {...initial} />)

    fireEvent.click(view.getByRole('button', { name: '移除图片 pixel.png' }))
    expect(onRemoveImage).toHaveBeenCalledWith(image.id)
    fireEvent.click(view.getByTitle('查看原图'))
    expect(view.getByRole('dialog', { name: '原图预览' })).toBeTruthy()
    view.rerender(<ComposerAttachments {...props({ attachments: [], onRemoveImage })} />)
    expect(view.queryByRole('dialog', { name: '原图预览' })).toBeNull()

    view.rerender(<ComposerAttachments {...initial} />)
    fireEvent.click(view.getByTitle('查看原图'))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(view.queryByRole('dialog', { name: '原图预览' })).toBeNull()
  })

  it('renders generic files with a document glyph and uppercase extension', () => {
    const file: ComposerAttachment = {
      kind: 'file',
      id: 'document-1' as ComposerAttachment['id'],
      file: new File([Uint8Array.of(1)], 'AGENTS.md', { type: 'text/markdown' }),
    }
    const view = render(<ComposerAttachments {...props({ attachments: [file] })} />)

    expect(view.getByText('AGENTS.md')).toBeTruthy()
    expect(view.getByText('MD')).toBeTruthy()
    expect(view.container.querySelector('[class*="fileGlyph"] svg')).toBeTruthy()
  })

  it('labels an unnamed attachment and its original-image preview', () => {
    const image = attachment('unnamed', '')
    const view = render(<ComposerAttachments {...props({ attachments: [image] })} />)
    expect(view.getByAltText('待发送图片')).toBeTruthy()
    fireEvent.click(view.getByTitle('查看原图'))
    expect(view.getByAltText('原图')).toBeTruthy()
  })
})
