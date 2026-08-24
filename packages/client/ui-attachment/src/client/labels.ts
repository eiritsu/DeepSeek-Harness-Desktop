import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { AttachmentRailLabels } from '../AttachmentRail.tsx'
import type { DropOverlayLabels } from '../DropOverlay.tsx'
import type { ImageLightboxLabels } from '../ImageLightbox.tsx'
import type { MessageImageLabels } from '../MessageImage.tsx'

/**
 * Resolve original-image lightbox strings from the conversation namespace.
 * @param t - conversation namespace translator.
 * @returns translated lightbox labels.
 */
export function lightboxLabels(t: TranslateNS<'conversation'>): ImageLightboxLabels {
  return { dialog: t('image.preview'), close: t('image.closePreview') }
}

/**
 * Resolve historical message-image strings from the conversation namespace.
 * @param t - conversation namespace translator.
 * @returns translated message-image labels.
 */
export function messageImageLabels(t: TranslateNS<'conversation'>): MessageImageLabels {
  return {
    image: t('image.label'),
    open: t('image.openOriginal'),
    openNamed: label => t('image.openOriginalLabel', { label }),
    loading: t('image.loading'),
    loadFailed: t('image.loadFailed'),
    lightbox: lightboxLabels(t),
  }
}

/**
 * Resolve the document-level drop invitation and its optional limits line.
 * @param t - conversation namespace translator.
 * @param accepting - whether the composer can accept dropped files.
 * @param limits - optional translated count and size values.
 * @returns translated drop-overlay labels.
 */
export function dropOverlayLabels(
  t: TranslateNS<'conversation'>,
  accepting: boolean,
  limits?: {
    readonly images?: { readonly count: number; readonly size: string }
    readonly files?: { readonly count: number; readonly size: string }
  },
): DropOverlayLabels {
  if (!accepting) return { title: t('image.dropBlocked') }
  const desc = limits?.images !== undefined && limits.files !== undefined
    ? t('attachment.dropDesc', {
      imageCount: limits.images.count,
      imageSize: limits.images.size,
      fileCount: limits.files.count,
      fileSize: limits.files.size,
    })
    : limits?.images !== undefined ? t('image.dropDesc', limits.images) : undefined
  return {
    title: t('image.dropTitle'),
    desc,
  }
}

/**
 * Resolve draft-image rail strings from the conversation namespace.
 * @param t - conversation namespace translator.
 * @returns translated attachment-rail labels.
 */
export function attachmentRailLabels(t: TranslateNS<'conversation'>): AttachmentRailLabels {
  return {
    group: t('attachment.pending'),
    open: t('image.openOriginal'),
    scrollLeft: t('image.scrollLeft'),
    scrollRight: t('image.scrollRight'),
  }
}
