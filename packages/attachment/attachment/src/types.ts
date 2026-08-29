/** Durable attachment vocabulary. @module @deepseek-ai/dsh-attachment/types */

import type { AttachmentId, ImageVariantId } from './brand.ts'

export type { AttachmentId } from './brand.ts'

/** Fallback media type when a transport cannot identify a generic file format. */
export const UNKNOWN_FILE_MEDIA_TYPE = 'application/octet-stream'

/** Durable, serializable reference to one immutable file kept byte-for-byte. */
export interface FileAttachmentRef {
  attachmentId: AttachmentId
  mediaType: string
  bytes: number
  name?: string
}

/** Legacy transient file input retained while callers migrate to durable refs. */
export interface FileRecognitionInput {
  data: Uint8Array
  mediaType: string
  name?: string
}

/** Deployment-resolved limits for generic file uploads. */
export interface FileAttachmentLimits {
  maxFileBytes: number
  maxFilesPerMessage: number
  maxMessageFileBytes: number
}

/** Base64-encoded generic file upload accompanying one wire request. */
export interface EncodedFileAttachment {
  mediaType: string
  data: string
  name?: string
}

/** Request to durably commit one generic file without transforming its bytes. */
export interface SaveFileAttachment {
  data: Uint8Array
  mediaType: string
  name?: string
}

/** Stored generic file bytes returned after reference and digest verification. */
export interface StoredFileAttachment {
  ref: FileAttachmentRef
  data: Uint8Array
  mediaType?: string
  name?: string
}

/** Bounded semantic text extracted from one durable file. */
export interface FileRecognitionResult {
  text: string
}

/** Effect-scoped recognizer contributed by a trusted attachment plugin. */
export interface FileRecognizer {
  /** Stable registration identity. */
  id: string
  /** Whether this recognizer owns the file or normalized image format. */
  supports(input: FileAttachmentRef | ImageAttachmentRef | FileRecognitionInput): boolean
  /** Extract bounded semantic text without changing the stored attachment. */
  recognize(
    input: StoredFileAttachment | StoredImageAttachment | FileRecognitionInput,
    signal?: AbortSignal,
  ): Promise<FileRecognitionResult | undefined>
}

/** Raster image formats accepted by the version-one attachment path. */
export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

/** Durable, serializable reference to one immutable normalized image. */
export interface ImageAttachmentRef {
  /** Opaque storage identifier; never a filesystem path or bearer URL. */
  attachmentId: AttachmentId
  /** Media type verified from the stored bytes. */
  mediaType: ImageMediaType
  /** Exact encoded byte length. */
  bytes: number
  /** Intrinsic encoded width in pixels. */
  width: number
  /** Intrinsic encoded height in pixels. */
  height: number
  /** Optional display name stripped of local path information. */
  name?: string
  /**
   * Input dimensions after applying EXIF orientation and before normalization
   * scaling. Present only when normalization reduced the image.
   */
  originalDimensions?: {
    width: number
    height: number
  }
}

/** Deployment-resolved limits used by upload admission and request buffering. */
export interface ImageAttachmentLimits {
  maxImageBytes: number
  maxImagesPerMessage: number
  maxMessageImageBytes: number
  maxImagePixels: number
  /** Maximum intrinsic width and maximum intrinsic height in pixels for one image. */
  maxImageDimension: number
  mediaTypes: readonly ImageMediaType[]
}

/** Base64-encoded image upload accompanying one wire request. */
export interface EncodedImageAttachment {
  /** Declared media type, verified against the decoded bytes during admission. */
  mediaType: ImageMediaType
  /** Canonical base64 encoding of the image bytes. */
  data: string
  /** Optional display name; it is never interpreted as a path. */
  name?: string
}

/** Request to validate and durably commit one image. */
export interface SaveImageAttachment {
  data: Uint8Array
  /** Caller-declared media type, checked against fully decoded bytes. */
  mediaType: ImageMediaType
  /** Optional browser/provider display name; it is never interpreted as a path. */
  name?: string
}

/** Stored image bytes returned after reference and digest verification. */
export interface StoredImageAttachment {
  ref: ImageAttachmentRef
  data: Uint8Array
  mediaType?: string
  name?: string
}

/** Any durable attachment reference understood by the storage seam. */
export type AttachmentRef = FileAttachmentRef | ImageAttachmentRef

/** Deterministic request-image policy selected by one exact model route. */
export interface ImageRequestPolicy {
  /** Maximum width multiplied by height after aspect-preserving projection. */
  maxPixels: number
  /** Encoded-byte target before base64 expansion or Files API upload; the smallest quality-ladder output is kept when no quality fits. */
  maxBytes: number
}

/** Cached request version derived from one provider-independent normalized attachment. */
export interface RequestImageAttachment {
  /** Cache and upload-index key over the attachment id, policy, and fixed encoder parameters. */
  variantId: ImageVariantId
  /** Durable normalized attachment from which this request version was derived. */
  attachment: ImageAttachmentRef
  /** Encoded request bytes. */
  data: Uint8Array
  mediaType: ImageMediaType
  bytes: number
  width: number
  height: number
  /** Provider-compatible sample depth proven after request encoding. */
  depth: 'uchar'
  /** Provider-compatible color space proven after request encoding. */
  space: 'srgb'
  /** Whether the encoded request version retains an alpha channel. */
  hasAlpha: boolean
}
