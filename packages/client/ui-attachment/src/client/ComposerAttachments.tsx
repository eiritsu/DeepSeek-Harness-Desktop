import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { zipSync } from 'fflate/browser'
import type {
  ComposerAttachment, ComposerAttachmentsProps,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { AttachmentRail } from '../AttachmentRail.tsx'
import type { AttachmentRailItem } from '../AttachmentRail.tsx'
import { DropOverlay } from '../DropOverlay.tsx'
import { ImageLightbox } from '../ImageLightbox.tsx'
import { attachmentRailLabels, dropOverlayLabels, lightboxLabels } from './labels.ts'
import css from './ComposerAttachments.module.css'
import { ATTACHMENT_PICKER_EVENT } from './events.ts'

/** Rail item retaining its browser-owned attachment for callbacks. */
interface ComposerRailItem extends AttachmentRailItem {
  attachment: ComposerAttachment
}

async function fileFromEntry(entry: FileSystemFileEntry): Promise<File> {
  return new Promise<File>((resolve, reject) => { entry.file(resolve, reject) })
}

async function directoryEntries(entry: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = entry.createReader()
  const entries: FileSystemEntry[] = []
  while (true) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => { reader.readEntries(resolve, reject) })
    if (batch.length === 0) return entries
    entries.push(...batch)
  }
}

async function collectDirectory(
  entry: FileSystemDirectoryEntry,
  prefix: string,
  files: Record<string, Uint8Array>,
): Promise<void> {
  for (const child of await directoryEntries(entry)) {
    const path = prefix === '' ? child.name : prefix + '/' + child.name
    if (child.isDirectory) {
      await collectDirectory(child as FileSystemDirectoryEntry, path, files)
    } else {
      const file = await fileFromEntry(child as FileSystemFileEntry)
      files[path] = new Uint8Array(await file.arrayBuffer())
    }
  }
}

async function archiveDirectory(entry: FileSystemDirectoryEntry): Promise<File> {
  const files: Record<string, Uint8Array> = {}
  await collectDirectory(entry, entry.name, files)
  return new File([zipSync(files)], entry.name + '.zip', { type: 'application/zip' })
}

async function archivePickedDirectory(files: readonly File[]): Promise<File | undefined> {
  if (files.length === 0) return undefined
  const entries: Record<string, Uint8Array> = {}
  for (const file of files) {
    const path = file.webkitRelativePath || file.name
    entries[path] = new Uint8Array(await file.arrayBuffer())
  }
  const firstPath = files[0]?.webkitRelativePath || files[0]?.name || 'folder'
  const root = firstPath.split('/')[0] || 'folder'
  return new File([zipSync(entries)], root + '.zip', { type: 'application/zip' })
}

async function droppedAttachments(transfer: DataTransfer): Promise<File[]> {
  const itemList = Reflect.get(transfer, 'items') as DataTransferItemList | undefined
  if (itemList === undefined) return [...transfer.files]
  const entries = Array.from({ length: itemList.length }, (_, index) => itemList[index])
    .filter((item): item is DataTransferItem => item !== undefined && item.kind === 'file')
    .map(item => item.webkitGetAsEntry())
    .filter((entry): entry is FileSystemEntry => entry !== null)
  if (entries.length === 0 || !entries.some(entry => entry.isDirectory)) return [...transfer.files]
  const files: File[] = []
  for (const entry of entries) {
    files.push(entry.isDirectory
      ? await archiveDirectory(entry as FileSystemDirectoryEntry)
      : await fileFromEntry(entry as FileSystemFileEntry))
  }
  return files
}

/** Draft-image rail, document drop target, and original-image preview slot entry. */
export function ComposerAttachments({
  attachments, canAcceptDrop, onAddImages, onRemoveImage, dropLimits, sessionId, t,
}: ComposerAttachmentsProps) {
  const [preview, setPreview] = useState<ComposerAttachment | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const dragDepth = useRef(0)
  const pickerRef = useRef<HTMLInputElement>(null)
  const closePreview = useCallback(() => { setPreview(null) }, [])

  useEffect(() => {
    if (preview !== null && !attachments.some(attachment => attachment.id === preview.id)) setPreview(null)
  }, [attachments, preview])

  useEffect(() => {
    const open = (event: Event): void => {
      if (!canAcceptDrop || sessionId === undefined || !(event instanceof CustomEvent)) return
      const detail = event.detail as { sessionId?: unknown }
      if (detail.sessionId === String(sessionId)) pickerRef.current?.click()
    }
    window.addEventListener(ATTACHMENT_PICKER_EVENT, open)
    return () => { window.removeEventListener(ATTACHMENT_PICKER_EVENT, open) }
  }, [canAcceptDrop, sessionId])

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
      if (canAcceptDrop) {
        void droppedAttachments(dataTransfer).then(onAddImages, (error: unknown) => {
          console.error('[ui-attachment] unable to read dropped folder:', error)
        })
      }
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

  const railItems = useMemo<ComposerRailItem[]>(() => attachments.map(attachment => ({
    id: attachment.id,
    ...(attachment.kind === 'image' ? { previewUrl: attachment.previewUrl } : {
      fileName: attachment.file.name || t('file.pending'),
      fileMeta: attachment.file.name.includes('.')
        ? attachment.file.name.split('.').pop()?.toLocaleUpperCase() || t('file.unknownType')
        : attachment.file.type.split('/').pop()?.toLocaleUpperCase() || t('file.unknownType'),
    }),
    alt: attachment.file.name || t('image.pending'),
    removeLabel: attachment.kind === 'image'
      ? t('image.remove', { name: attachment.file.name })
      : t('file.remove', { name: attachment.file.name }),
    attachment,
  })), [attachments, t])

  return (
    <>
      <input
        ref={pickerRef}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          const files = [...event.currentTarget.files ?? []]
          event.currentTarget.value = ''
          if (files.length === 0) return
          if (!files.some(file => file.webkitRelativePath.length > 0)) {
            onAddImages(files)
            return
          }
          void archivePickedDirectory(files).then((archive) => {
            if (archive !== undefined) onAddImages([archive])
          }, (error: unknown) => {
            console.error('[ui-attachment] unable to read selected folder:', error)
          })
        }}
      />
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
            onOpen={(item) => {
              if (item.attachment.kind === 'image') setPreview(item.attachment)
            }}
            onRemove={(item) => { onRemoveImage(item.attachment.id) }}
          />
        </div>
      )}
      {preview !== null && preview.kind === 'image' && (
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
