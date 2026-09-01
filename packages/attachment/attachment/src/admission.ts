/** Wire-form admission of base64-encoded image uploads. @module @deepseek-ai/dsh-attachment/admission */

import { Buffer } from 'node:buffer'
import { AttachmentError } from './error.ts'
import type { AttachmentStore } from './index.ts'
import { UNKNOWN_FILE_MEDIA_TYPE } from './types.ts'
import type { EncodedFileAttachment, EncodedImageAttachment, FileAttachmentRef, ImageAttachmentRef, SaveFileAttachment, SaveImageAttachment } from './types.ts'
import type { AdmittedPromptContentPart, PromptContentPart } from './types.ts'

/** Decode one upload payload while rejecting non-canonical base64 forms. */
function decodeBase64(data: string, subject: 'Image' | 'File'): Uint8Array {
  const decoded = Buffer.from(data, 'base64')
  if (data.length === 0 || decoded.toString('base64') !== data) {
    throw new AttachmentError(`${subject} upload is not canonical base64.`, subject === 'Image' ? 'INVALID_IMAGE_BASE64' : 'INVALID_FILE_BASE64')
  }
  return new Uint8Array(decoded)
}

/** Store input for one decoded upload. */
function saveInput(image: EncodedImageAttachment): SaveImageAttachment {
  return {
    data: decodeBase64(image.data, 'Image'),
    mediaType: image.mediaType,
    ...image.name === undefined ? {} : { name: image.name },
  }
}

function saveFileInput(file: EncodedFileAttachment): SaveFileAttachment {
  return { data: decodeBase64(file.data, 'File'), mediaType: file.mediaType || UNKNOWN_FILE_MEDIA_TYPE, ...(file.name === undefined ? {} : { name: file.name }) }
}

/**
 * Admit one wire image batch: enforce canonical base64 on every member, then
 * delegate batch admission — count and aggregate-byte limits, media-type and
 * per-image validation, ordered commit — to {@link AttachmentStore.saveImages}.
 * The shared entry for every RPC endpoint accepting browser uploads.
 * @param attachments - the deployment attachment store owning batch policy.
 * @param images - base64-encoded uploads in caller order.
 * @returns durable references in the same order as `images`.
 * @throws AttachmentError on a non-canonical payload or a refused batch.
 */
export async function admitEncodedImages(
  attachments: AttachmentStore,
  images: readonly EncodedImageAttachment[],
): Promise<readonly ImageAttachmentRef[]> {
  return attachments.saveImages(images.map(saveInput))
}

/**
 * Admit a browser prompt and replace each uploaded attachment with a durable reference.
 * @param attachments - attachment store owning admission policy.
 * @param content - prompt parts containing text, image, or generic-file uploads.
 * @returns prompt parts with durable attachment references.
 */
export async function admitPromptContent(
  attachments: AttachmentStore,
  content: readonly PromptContentPart[],
): Promise<AdmittedPromptContentPart[]> {
  const images = content.filter(part => part.type === 'image')
  const files = content.filter(part => part.type === 'file')
  const imageRefs = images.length === 0 ? [] : await admitEncodedImages(attachments, images)
  const fileRefs = files.length === 0 ? [] : await admitEncodedFiles(attachments, files)
  let imageIndex = 0
  let fileIndex = 0
  return content.map((part) => {
    if (part.type === 'text') return { type: 'text', text: part.text }
    if (part.type === 'image') return { type: 'image', attachment: imageRefs[imageIndex++] as ImageAttachmentRef }
    return { type: 'file', attachment: fileRefs[fileIndex++] as FileAttachmentRef }
  })
}

/**
 * Admit one wire generic-file batch and durably store the original bytes.
 * @param attachments - attachment store owning admission policy.
 * @param files - base64-encoded generic-file uploads in caller order.
 * @returns durable references in the same order as `files`.
 */
export async function admitEncodedFiles(
  attachments: AttachmentStore,
  files: readonly EncodedFileAttachment[],
): Promise<readonly FileAttachmentRef[]> {
  return attachments.saveFiles(files.map(saveFileInput))
}
