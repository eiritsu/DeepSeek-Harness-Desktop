/** Durable attachment storage seam (`ctx.attachments`). @module @deepseek-ai/dsh-attachment */

import { Context, Service } from '@deepseek-ai/cordis'
import { AttachmentError } from './error.ts'
import type {
  FileAttachmentLimits,
  FileAttachmentRef,
  FileRecognitionResult,
  FileRecognizer,
  ImageAttachmentLimits,
  ImageAttachmentRef,
  ImageRequestPolicy,
  RequestImageAttachment,
  SaveFileAttachment,
  SaveImageAttachment,
  StoredImageAttachment,
  StoredFileAttachment,
} from './types.ts'

export { AttachmentId, ImageVariantId } from './brand.ts'
export { AttachmentError, isFileAdmissionError, isImageAdmissionError } from './error.ts'
export type { AttachmentErrorCode, FileAdmissionErrorCode, ImageAdmissionErrorCode } from './error.ts'
export { admitEncodedFiles, admitEncodedImages } from './admission.ts'
export { nativeFileModality } from './media.ts'
export type { NativeFileModality } from './media.ts'
export type {
  AttachmentRef,
  AttachmentId as AttachmentIdType,
  EncodedFileAttachment,
  EncodedImageAttachment,
  FileAttachmentLimits,
  FileAttachmentRef,
  FileRecognitionResult,
  FileRecognizer,
  ImageAttachmentLimits,
  ImageAttachmentRef,
  ImageRequestPolicy,
  ImageMediaType,
  RequestImageAttachment,
  SaveFileAttachment,
  SaveImageAttachment,
  StoredFileAttachment,
  StoredImageAttachment,
} from './types.ts'
export { UNKNOWN_FILE_MEDIA_TYPE } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    attachments: AttachmentStore
  }
}

/** Immutable binary attachment service. Implementations validate bytes before publishing a reference. */
export abstract class AttachmentStore extends Service {
  private readonly fileRecognizers: FileRecognizer[] = []
  constructor(ctx: Context) {
    super(ctx, 'attachments')
  }

  /** Deployment-resolved image policy used by authoritative and fast-path validation. */
  abstract readonly imageLimits: ImageAttachmentLimits

  /** Deployment-resolved generic file policy used by authoritative and fast-path validation. */
  abstract readonly fileLimits: FileAttachmentLimits

  /**
   * Register one trusted file recognizer in precedence order.
   * @param recognizer - effect-scoped format recognizer.
   * @returns disposer removing this exact recognizer.
   */
  registerFileRecognizer(recognizer: FileRecognizer): () => void {
    if (this.fileRecognizers.some(candidate => candidate.id === recognizer.id)) {
      throw new Error('attachment recognizer "' + recognizer.id + '" is already registered')
    }
    this.fileRecognizers.push(recognizer)
    return () => {
      const index = this.fileRecognizers.indexOf(recognizer)
      if (index >= 0) this.fileRecognizers.splice(index, 1)
    }
  }

  /**
   * Read one file and ask the first supporting recognizer for semantic text.
   * @param ref - durable file reference selected for recognition.
   * @param signal - optional cancellation for read and recognition work.
   * @returns bounded recognized text, or undefined when no recognizer supports or accepts the file.
   */
  async recognizeFile(ref: FileAttachmentRef, signal?: AbortSignal): Promise<FileRecognitionResult | undefined> {
    signal?.throwIfAborted()
    const recognizer = this.fileRecognizers.find(candidate => candidate.supports(ref))
    if (recognizer === undefined) return undefined
    return recognizer.recognize(await this.readFile(ref, signal), signal)
  }

  /**
   * Read one normalized image and ask the first supporting recognizer for semantic text.
   * @param ref - durable image selected for recognition.
   * @param signal - optional cancellation for read and recognition work.
   * @returns bounded recognized text, or undefined when no recognizer supports or accepts the image.
   */
  async recognizeImage(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<FileRecognitionResult | undefined> {
    signal?.throwIfAborted()
    const recognizer = this.fileRecognizers.find(candidate => candidate.supports(ref))
    if (recognizer === undefined) return undefined
    return recognizer.recognize(await this.readImage(ref, signal), signal)
  }

  /**
   * Validate and durably commit one ordered generic file batch.
   * @param inputs - raw files in owning-message order.
   * @returns immutable references in the same order after every file succeeds.
   */
  async saveFiles(inputs: readonly SaveFileAttachment[]): Promise<readonly FileAttachmentRef[]> {
    const { maxFilesPerMessage, maxMessageFileBytes, maxFileBytes } = this.fileLimits
    if (inputs.length > maxFilesPerMessage) {
      throw new AttachmentError('File batch exceeds the configured file-count limit.', 'TOO_MANY_FILES')
    }
    const totalBytes = inputs.reduce((sum, input) => sum + input.data.byteLength, 0)
    if (totalBytes > maxMessageFileBytes) {
      throw new AttachmentError('File batch exceeds the configured aggregate file-byte limit.', 'FILES_TOO_LARGE')
    }
    for (const input of inputs) {
      if (input.data.byteLength > maxFileBytes) {
        throw new AttachmentError('File exceeds the configured byte limit.', 'FILE_TOO_LARGE')
      }
      if (input.mediaType.length === 0 || input.mediaType.length > 255 || /[\u0000-\u001f\u007f]/.test(input.mediaType)) {
        throw new AttachmentError('File media type is invalid.', 'INVALID_FILE_MEDIA_TYPE')
      }
    }
    const refs: FileAttachmentRef[] = []
    for (const input of inputs) refs.push(await this.saveFile(input))
    return refs
  }

  /**
   * Durably commit one generic file without changing its bytes.
   * @param input - raw bytes, media type, and optional display name.
   * @returns immutable content-addressed reference.
   */
  abstract saveFile(input: SaveFileAttachment): Promise<FileAttachmentRef>

  /**
   * Read one generic file and verify its digest and recorded metadata.
   * @param ref - durable reference from the session log.
   * @param signal - optional cancellation.
   * @returns verified original bytes and reference.
   */
  abstract readFile(ref: FileAttachmentRef, signal?: AbortSignal): Promise<StoredFileAttachment>

  /**
   * Validate one image without persisting it.
   * Batch callers validate every member before saving any member.
   * @param input - encoded bytes, declared media type, and optional display name.
   * @returns completion after the encoded raster has been fully decoded.
   */
  abstract validateImage(input: SaveImageAttachment): Promise<void>

  /**
   * Validate one ordered image batch before committing any member.
   * Validation failures start no writes; storage failures return no partial
   * references, although already published content-addressed objects may stay
   * unreachable until a future retention policy collects them.
   * @param inputs - encoded images in their owning message order.
   * @returns durable references in the exact input order.
   */
  protected validateImageBatch(inputs: readonly SaveImageAttachment[]): void {
    const { maxImagesPerMessage, maxMessageImageBytes, mediaTypes } = this.imageLimits
    if (inputs.length > maxImagesPerMessage) {
      throw new AttachmentError('Image batch exceeds the configured image-count limit.', 'TOO_MANY_IMAGES')
    }
    const totalBytes = inputs.reduce((sum, input) => sum + input.data.byteLength, 0)
    if (totalBytes > maxMessageImageBytes) {
      throw new AttachmentError('Image batch exceeds the configured aggregate image-byte limit.', 'IMAGES_TOO_LARGE')
    }
    for (const input of inputs) {
      if (!mediaTypes.includes(input.mediaType)) {
        throw new AttachmentError(`Image type ${input.mediaType} is not accepted by this deployment.`, 'UNSUPPORTED_IMAGE_TYPE')
      }
    }
  }

  /**
   * Validate and durably commit one ordered image batch.
   * @param inputs - encoded images in owning-message order.
   * @returns durable normalized attachment references in the same order after every member succeeds.
   */
  async saveImages(inputs: readonly SaveImageAttachment[]): Promise<readonly ImageAttachmentRef[]> {
    this.validateImageBatch(inputs)
    for (const input of inputs) await this.validateImage(input)

    const refs: ImageAttachmentRef[] = []
    for (const input of inputs) refs.push(await this.saveImage(input))
    return refs
  }

  /**
   * Validate and durably commit one image before its owning session event is appended.
   * The returned reference describes the persisted normalized image. When
   * normalization reduces the raster, its `originalDimensions` records the
   * orientation-applied input dimensions.
   * @param input - encoded bytes, declared media type, and optional display name.
   * @returns the durable content-addressed normalized image reference.
   */
  abstract saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef>

  /**
   * Read one image and verify that bytes still match the recorded reference.
   * @param ref - durable reference from the session log.
   * @param signal - optional cancellation for backend read and verification work.
   * @returns the verified bytes and normalized attachment reference.
   * @throws the signal reason when aborted, or a storage error when verification fails.
   */
  abstract readImage(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<StoredImageAttachment>

  /**
   * Generate or read one deterministic model-request version from the stored normalized image.
   * @param ref - durable provider-independent normalized attachment reference.
   * @param policy - exact route pixel and encoded-byte budget.
   * @param signal - optional cancellation.
   * @returns request bytes and the cache/upload identity covering every transform input.
   */
  readImageRequest(
    ref: ImageAttachmentRef,
    policy: ImageRequestPolicy,
    signal?: AbortSignal,
  ): Promise<RequestImageAttachment> {
    signal?.throwIfAborted()
    void ref
    void policy
    return Promise.reject(new AttachmentError(
      'The mounted attachment provider cannot derive model-request images.',
      'ATTACHMENT_PROJECTION_UNSUPPORTED',
    ))
  }

}

export default AttachmentStore
