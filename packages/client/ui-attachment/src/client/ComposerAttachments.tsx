import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ComposerAttachment, ComposerAttachmentsProps,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { AttachmentRail } from '../AttachmentRail.tsx'
import type { AttachmentRailItem } from '../AttachmentRail.tsx'
import { DropOverlay } from '../DropOverlay.tsx'
import { ImageLightbox } from '../ImageLightbox.tsx'
import { attachmentRailLabels, dropOverlayLabels, lightboxLabels } from './labels.ts'
import css from './ComposerAttachments.module.css'
import { ATTACHMENT_PICKER_EVENT } from './picker-event.ts'

/** Rail item retaining its browser-owned attachment for callbacks. */
interface ComposerRailItem extends AttachmentRailItem {
  attachment: ComposerAttachment
}

/** Resolve the short file-type label shown in a Codex-style file card. */
function fileTypeLabel(file: File): string | undefined {
  const extension = /\.([^./]+)$/.exec(file.name)?.[1]
  if (extension !== undefined && extension.length > 0) return extension.toUpperCase()
  const subtype = file.type.split('/')[1]
  return subtype === undefined || subtype === '' ? undefined : subtype.toUpperCase()
}

/** Draft-image rail, document drop target, and original-image preview slot entry. */
export function ComposerAttachments({
  attachments, canAcceptDrop, onAddImages, onRemoveImage, onInsertText, dropLimits, t,
}: ComposerAttachmentsProps) {
  const [preview, setPreview] = useState<ComposerAttachment | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const dragDepth = useRef(0)
  const pickerRef = useRef<HTMLInputElement | null>(null)
  const closePreview = useCallback(() => { setPreview(null) }, [])

  useEffect(() => {
    if (preview !== null && !attachments.some(attachment => attachment.id === preview.id)) setPreview(null)
  }, [attachments, preview])

  useEffect(() => {
    const fileTransfer = (event: globalThis.DragEvent): DataTransfer | null => {
      const dataTransfer = event.dataTransfer
      if (dataTransfer === null || !dataTransfer.types.includes('Files')) return null
      return dataTransfer
    }
    const reset = (): void => {
      dragDepth.current = 0
      setDragActive(false)
    }
    const onDragEnter = (event: globalThis.DragEvent): void => {
      if (fileTransfer(event) === null) return
      event.preventDefault()
      dragDepth.current += 1
      setDragActive(true)
    }
    const onDragOver = (event: globalThis.DragEvent): void => {
      const dataTransfer = fileTransfer(event)
      if (dataTransfer === null) return
      event.preventDefault()
      dataTransfer.dropEffect = canAcceptDrop ? 'copy' : 'none'
    }
    const onDragLeave = (event: globalThis.DragEvent): void => {
      if (fileTransfer(event) === null) return
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setDragActive(false)
      const leftViewport = event.clientX <= 0 || event.clientY <= 0
        || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight
      if ((event.target === document.documentElement || event.target === document.body) && leftViewport) reset()
    }
    const onDrop = (event: globalThis.DragEvent): void => {
      const dataTransfer = fileTransfer(event)
      if (dataTransfer === null) return
      event.preventDefault()
      reset()
      if (!canAcceptDrop) return
      const items = dataTransfer.items
      const validFiles: File[] = []
      if (items && items.length > 0) {
        for (let i = 0; i < items.length; i += 1) {
          const item = items[i]
          if (item === undefined || item.kind !== 'file') continue
          const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null
          if (entry?.isDirectory) continue
          const file = item.getAsFile()
          if (file !== null) validFiles.push(file)
        }
      } else {
        validFiles.push(...dataTransfer.files)
      }
      if (validFiles.length > 0) onAddImages(validFiles)
    }
    document.addEventListener('dragenter', onDragEnter)
    document.addEventListener('dragover', onDragOver)
    document.addEventListener('dragleave', onDragLeave)
    document.addEventListener('drop', onDrop)
    window.addEventListener('dragend', reset)
    return () => {
      document.removeEventListener('dragenter', onDragEnter)
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('dragleave', onDragLeave)
      document.removeEventListener('drop', onDrop)
      window.removeEventListener('dragend', reset)
    }
  }, [canAcceptDrop, onAddImages])

  useEffect(() => {
    const handleNativeItems = (items: { kind: string; path: string; name: string; mime?: string; dataBase64?: string }[]) => {
      if (!items || items.length === 0) return
      const imageFiles: File[] = []
      const textMentions: string[] = []
      for (const item of items) {
        if (item.kind === 'image' && item.dataBase64 && item.mime) {
          const binary = atob(item.dataBase64)
          const array = new Uint8Array(binary.length)
          for (let i = 0; i < binary.length; i += 1) array[i] = binary.charCodeAt(i)
          imageFiles.push(new File([array], item.name, { type: item.mime }))
        } else if (item.kind === 'directory') {
          const mention = item.path.includes(' ') ? `@\"${item.path}/\"` : `@${item.path}/`
          textMentions.push(mention)
        } else {
          const mention = item.path.includes(' ') ? `@\"${item.path}\"` : `@${item.path}`
          textMentions.push(mention)
        }
      }
      if (imageFiles.length > 0 && canAcceptDrop) {
        onAddImages(imageFiles)
      }
      if (textMentions.length > 0 && onInsertText) {
        onInsertText(textMentions.join(' ') + ' ')
      }
    }

    const onPickerRequest = (event: Event): void => {
      if (!(event instanceof CustomEvent)) return
      const kind = (event.detail as { kind?: unknown } | null)?.kind
      if (kind !== 'files') return

      const bridge = (window as unknown as {
        dshDesktopPluginBridge?: { request: (req: unknown) => Promise<unknown> }
      }).dshDesktopPluginBridge

      if (bridge) {
        bridge.request({ action: 'chooseContext' }).then((res: unknown) => {
          const payload = res as {
            items?: { kind: string; path: string; name: string; mime?: string; dataBase64?: string }[]
          } | null
          if (payload?.items) handleNativeItems(payload.items)
        }).catch(() => {
          pickerRef.current?.click()
        })
      } else {
        pickerRef.current?.click()
      }
    }

    const onNativeDrop = (event: Event): void => {
      if (!(event instanceof CustomEvent)) return
      dragDepth.current = 0
      setDragActive(false)
      const payload = event.detail as {
        items?: { kind: string; path: string; name: string; mime?: string; dataBase64?: string }[]
      } | null
      if (payload?.items) handleNativeItems(payload.items)
    }

    window.addEventListener(ATTACHMENT_PICKER_EVENT, onPickerRequest)
    window.addEventListener('dsh:native-drop', onNativeDrop)
    return () => {
      window.removeEventListener(ATTACHMENT_PICKER_EVENT, onPickerRequest)
      window.removeEventListener('dsh:native-drop', onNativeDrop)
    }
  }, [canAcceptDrop, onAddImages, onInsertText])

  const railItems = useMemo<ComposerRailItem[]>(() => attachments.map((attachment) => {
    const common = {
      id: attachment.id,
      ...(attachment.previewUrl === undefined ? {} : { previewUrl: attachment.previewUrl }),
      alt: attachment.file.name || (attachment.kind === 'image' ? t('image.pending') : t('attachment.file')),
      removeLabel: attachment.kind === 'image'
        ? t('image.remove', { name: attachment.file.name })
        : t('attachment.remove', { name: attachment.file.name }),
      attachment,
    }
    if (attachment.kind === 'image') return common
    const meta = fileTypeLabel(attachment.file)
    return {
      ...common,
      name: attachment.file.name || t('attachment.file'),
      ...(meta === undefined ? {} : { meta }),
    }
  }), [attachments, t])

  return (
    <>
      <input ref={pickerRef} type="file" multiple hidden onChange={(event) => {
        const files = [...(event.currentTarget.files ?? [])]
        if (files.length > 0) onAddImages(files)
        event.currentTarget.value = ''
      }} />
      {dragActive && (
        <DropOverlay
          disabled={!canAcceptDrop}
          labels={dropOverlayLabels(t, canAcceptDrop, dropLimits)}
        />
      )}
      {railItems.length > 0 && (
        <div className={css.rail}>
          <AttachmentRail
            items={railItems}
            labels={attachmentRailLabels(t)}
            onOpen={(item) => { if (item.attachment.previewUrl !== undefined) setPreview(item.attachment) }}
            onRemove={(item) => { onRemoveImage(item.attachment.id) }}
          />
        </div>
      )}
      {preview !== null && (
        preview.previewUrl !== undefined &&
        <ImageLightbox
          src={preview.previewUrl}
          alt={preview.file.name || t('image.original')}
          labels={lightboxLabels(t)}
          onClose={closePreview}
        />
      )}
    </>
  )
}
