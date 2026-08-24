/**
 * Harness request-history conversion into pi-ai's Context vocabulary.
 *
 * @module dsh-llm-pi-ai/context
 */

import { CallId, contentHasFile, contentHasImage, LlmError, offloadRequestFiles, offloadRequestImagesWithPolicy, requestImageHandleText } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, Message, ModelModality } from '@deepseek-ai/dsh-llm'
import { nativeFileModality } from '@deepseek-ai/dsh-attachment'
import type {
  AttachmentId,
  AttachmentStore,
  FileAttachmentRef,
  ImageAttachmentRef,
  ImageRequestPolicy,
  RequestImageAttachment,
  StoredFileAttachment,
} from '@deepseek-ai/dsh-attachment'
import type { Context as PiContext, ImageContent, Message as PiMessage, TextContent, Tool as PiTool } from '@earendil-works/pi-ai'
import { toPiAssistant } from './replay.ts'
import { DEFAULT_REQUEST_IMAGE_MAX_BYTES, DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET } from './config.ts'

/** Join the text blocks of a harness message. */
function flattenText(message: Message): string {
  return message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}


/** Flatten text recursively inside one tool result. */
function toolResultText(blocks: readonly ContentBlock[]): string {
  return blocks.map(block => block.type === 'text'
    ? block.text
    : block.type === 'tool-result' ? toolResultText(block.content) : '').join('')
}

/** Reject binary roles that pi-ai cannot replay before request conversion. */
function assertSupportedBinaryRoles(messages: readonly Message[]): void {
  for (const message of messages) {
    if (message.role !== 'user' && (contentHasImage(message.content) || contentHasFile(message.content))) {
      throw new LlmError(
        `pi-ai cannot represent binary content in an in-history ${message.role} message`,
        'UNSUPPORTED_CONTENT',
      )
    }
  }
}

async function userContent(
  blocks: readonly ContentBlock[],
  requestImages: ReadonlyMap<AttachmentId, RequestImageAttachment>,
  requestFiles: ReadonlyMap<AttachmentId, StoredFileAttachment>,
): Promise<string | (TextContent | ImageContent)[]> {
  const content: (TextContent | ImageContent)[] = []
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        if (block.text.length > 0) content.push({ type: 'text', text: block.text })
        break
      case 'image': {
        const version = requestImages.get(block.attachment.attachmentId) as RequestImageAttachment
        content.push({ type: 'text', text: requestImageHandleText(version) })
        content.push({
          type: 'image',
          data: Buffer.from(version.data).toString('base64'),
          mimeType: version.mediaType,
        })
        break
      }
      case 'file': {
        const stored = requestFiles.get(block.attachment.attachmentId) as StoredFileAttachment
        // pi-ai names this generic binary content `ImageContent`, while its
        // Google converters serialize the supplied MIME type as inlineData.
        // The adapter enables native file modalities only for those APIs.
        content.push({
          type: 'image',
          data: Buffer.from(stored.data).toString('base64'),
          mimeType: stored.ref.mediaType,
        })
        break
      }
      case 'tool-result':
        {
          const nested = await userContent(block.content, requestImages, requestFiles)
          if (typeof nested === 'string') {
            if (nested.length > 0) content.push({ type: 'text', text: nested })
          } else {
            content.push(...nested)
          }
        }
        break
      default:
        // Other merge-extensible blocks are not user-input vocabulary for pi-ai.
        break
    }
  }
  if (content.every(block => block.type === 'text')) return content.map(block => block.text).join('')
  return content
}

function collectFileRefs(
  blocks: readonly ContentBlock[],
  refs: Map<AttachmentId, FileAttachmentRef>,
): void {
  for (const block of blocks) {
    if (block.type === 'file') refs.set(block.attachment.attachmentId, block.attachment)
    else if (block.type === 'tool-result') collectFileRefs(block.content, refs)
  }
}

async function prepareRequestFiles(
  messages: readonly Message[],
  attachments: AttachmentStore,
  inputModalities: readonly ModelModality[],
  signal?: AbortSignal,
): Promise<Map<AttachmentId, StoredFileAttachment>> {
  const refs = new Map<AttachmentId, FileAttachmentRef>()
  for (const message of messages) collectFileRefs(message.content, refs)
  const orderedRefs = [...refs.values()]
  for (const ref of orderedRefs) {
    const modality = nativeFileModality(ref)
    if (modality === undefined || !inputModalities.includes(modality)) {
      throw new LlmError('pi-ai received a generic file without a native transport modality', 'UNSUPPORTED_CONTENT')
    }
  }
  const prepared = await Promise.all(orderedRefs.map(ref => attachments.readFile(ref, signal)))
  return new Map(orderedRefs.map((ref, index) => [ref.attachmentId, prepared[index] as StoredFileAttachment]))
}

function collectImageRefs(
  blocks: readonly ContentBlock[],
  refs: Map<AttachmentId, ImageAttachmentRef>,
): void {
  for (const block of blocks) {
    if (block.type === 'image') refs.set(block.attachment.attachmentId, block.attachment)
    else if (block.type === 'tool-result') collectImageRefs(block.content, refs)
  }
}

async function prepareRequestImages(
  messages: readonly Message[],
  attachments: AttachmentStore,
  policy: ImageRequestPolicy,
  signal?: AbortSignal,
): Promise<Map<AttachmentId, RequestImageAttachment>> {
  const refs = new Map<AttachmentId, ImageAttachmentRef>()
  for (const message of messages) collectImageRefs(message.content, refs)
  const orderedRefs = [...refs.values()]
  const prepared = await Promise.all(orderedRefs.map(
    ref => attachments.readImageRequest(ref, policy, signal),
  ))
  const versions = new Map<AttachmentId, RequestImageAttachment>()
  for (const [index, ref] of orderedRefs.entries()) {
    versions.set(ref.attachmentId, prepared[index] as RequestImageAttachment)
  }
  return versions
}

function toolsOf(options: GenerateOptions): PiTool[] | undefined {
  return options.tools?.map(tool => ({
    name: tool.name,
    description: tool.description,
    // ToolSchema.parameters is a JSON Schema object; pi-ai's TSchema
    // (TypeBox) is structurally JSON Schema, so it assigns directly.
    parameters: tool.parameters,
  }))
}

/** Assemble the request-level pi-ai context envelope shared by both conversion paths. */
function piContext(options: GenerateOptions, messages: PiMessage[]): PiContext {
  const tools = toolsOf(options)
  return {
    ...options.system !== undefined ? { systemPrompt: options.system } : {},
    messages,
    ...tools !== undefined && tools.length > 0 ? { tools } : {},
  }
}

function textOnlyContext(options: GenerateOptions, onReplayDegrade?: (reason: string) => void): PiContext {
  const toolNames = new Map<CallId, string>()
  const messages: PiMessage[] = []
  for (const message of options.messages) {
    if (contentHasImage(message.content) || contentHasFile(message.content)) {
      throw new LlmError('pi-ai attachment conversion requires the durable attachment service', 'UNSUPPORTED_CONTENT')
    }
    if (message.role === 'system') {
      messages.push({ role: 'user', content: flattenText(message), timestamp: 0 })
      continue
    }
    if (message.role === 'assistant') {
      const assistant = toPiAssistant(message, onReplayDegrade)
      for (const block of assistant.content) if (block.type === 'toolCall') toolNames.set(CallId(block.id), block.name)
      messages.push(assistant)
      continue
    }
    const text = flattenText(message)
    const results = message.content.filter(block => block.type === 'tool-result')
    if (text.length > 0 || results.length === 0) messages.push({ role: 'user', content: text, timestamp: 0 })
    for (const result of results) {
      messages.push({
        role: 'toolResult',
        toolCallId: result.toolCallId,
        toolName: toolNames.get(result.toolCallId) ?? 'unknown',
        content: [{
          type: 'text',
          text: toolResultText(result.content) || '(no output)',
        }],
        isError: result.isError ?? false,
        timestamp: 0,
      })
    }
  }
  return piContext(options, messages)
}

/**
 * Convert text-only harness history to a synchronous pi-ai Context. Tool
 * result names are recovered from preceding assistant tool calls.
 * @param options - the harness request; `options.system` maps to pi-ai's single `systemPrompt` slot.
 * @param attachments - absent; selects the synchronous conversion.
 * @param onReplayDegrade - forwarded to {@link toPiAssistant} for each assistant message.
 * @returns the pi-ai context; `tools` is omitted when the request declares none.
 */
export function toPiContext(
  options: GenerateOptions,
  attachments?: undefined,
  onReplayDegrade?: (reason: string) => void,
): PiContext
/**
 * Convert harness history to a pi-ai Context while resolving durable attachments.
 * Tool result names are recovered from preceding assistant tool calls. When
 * the accumulated base64 image payload exceeds `maxRequestImageBytes`, the
 * oldest images are replaced by text placeholders until the request fits, so
 * an image-heavy session keeps clearing gateway request-size caps.
 * @param options - the harness request; `options.system` maps to pi-ai's single `systemPrompt` slot.
 * @param attachments - durable byte resolver for image and file references.
 * @param onReplayDegrade - forwarded to {@link toPiAssistant} for each assistant message.
 * @param maxRequestImageBytes - request-level bound on base64-encoded image payload; omission leaves every image in place.
 * @param requestImagePolicy - route pixel and raw encoded-byte budgets.
 * @param inputModalities - exact binary modalities the selected protocol can serialize.
 * @param maxRequestFileBytes - request-level bound on base64 generic-file payload.
 * @returns the asynchronously resolved pi-ai context.
 */
export function toPiContext(
  options: GenerateOptions,
  attachments: AttachmentStore,
  onReplayDegrade?: (reason: string) => void,
  maxRequestImageBytes?: number,
  requestImagePolicy?: ImageRequestPolicy,
  inputModalities?: readonly ModelModality[],
  maxRequestFileBytes?: number,
): Promise<PiContext>
export function toPiContext(
  options: GenerateOptions,
  attachments?: AttachmentStore,
  onReplayDegrade?: (reason: string) => void,
  maxRequestImageBytes?: number,
  requestImagePolicy?: ImageRequestPolicy,
  inputModalities: readonly ModelModality[] = ['text', 'image'],
  maxRequestFileBytes?: number,
): PiContext | Promise<PiContext> {
  return attachments === undefined
    ? textOnlyContext(options, onReplayDegrade)
    : toPiContextWithAttachments(
      options,
      attachments,
      onReplayDegrade,
      maxRequestImageBytes,
      requestImagePolicy,
      inputModalities,
      maxRequestFileBytes,
    )
}

async function toPiContextWithAttachments(
  options: GenerateOptions,
  attachments: AttachmentStore,
  onReplayDegrade?: (reason: string) => void,
  maxRequestImageBytes?: number,
  requestImagePolicy: ImageRequestPolicy = {
    maxPixels: DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET,
    maxBytes: DEFAULT_REQUEST_IMAGE_MAX_BYTES,
  },
  inputModalities: readonly ModelModality[] = ['text', 'image'],
  maxRequestFileBytes?: number,
): Promise<PiContext> {
  assertSupportedBinaryRoles(options.messages)
  const imageLimitedMessages = offloadRequestImagesWithPolicy(options.messages, {
    representation: 'base64',
    ...maxRequestImageBytes === undefined ? {} : { maxBytes: maxRequestImageBytes },
    byteQuantum: 1,
    byteLength: ref => Math.min(ref.bytes, requestImagePolicy.maxBytes),
  })
  const requestMessages = offloadRequestFiles(imageLimitedMessages, maxRequestFileBytes)
  const requestImages = await prepareRequestImages(requestMessages, attachments, requestImagePolicy, options.signal)
  const requestFiles = await prepareRequestFiles(requestMessages, attachments, inputModalities, options.signal)
  const exactMessages = offloadRequestImagesWithPolicy(requestMessages, {
    representation: 'base64',
    ...maxRequestImageBytes === undefined ? {} : { maxBytes: maxRequestImageBytes },
    byteQuantum: 1,
    byteLength: ref => (requestImages.get(ref.attachmentId) as RequestImageAttachment).bytes,
  })
  const toolNames = new Map<CallId, string>()
  const messages: PiMessage[] = []

  for (const message of exactMessages) {
    if (message.role === 'system') {
      // pi-ai has a single systemPrompt slot; in-history system messages are
      // folded into user messages to preserve order (rare in practice — the
      // harness sends the system prompt via options.system).
      messages.push({ role: 'user', content: flattenText(message), timestamp: 0 })
      continue
    }
    if (message.role === 'assistant') {
      const assistant = toPiAssistant(message, onReplayDegrade)
      for (const block of assistant.content) {
        if (block.type === 'toolCall') toolNames.set(CallId(block.id), block.name)
      }
      messages.push(assistant)
      continue
    }
    // user role: text + tool results (each result becomes its own message).
    const regular = message.content.filter(block => block.type !== 'tool-result')
    const content = await userContent(regular, requestImages, requestFiles)
    const results = message.content.filter((block): block is Extract<ContentBlock, { type: 'tool-result' }> => (
      block.type === 'tool-result'
    ))
    if (content.length > 0 || results.length === 0) {
      messages.push({ role: 'user', content, timestamp: 0 })
    }
    for (const result of results) {
      const resultContent = await userContent(result.content, requestImages, requestFiles)
      messages.push({
        role: 'toolResult',
        toolCallId: result.toolCallId,
        toolName: toolNames.get(result.toolCallId) ?? 'unknown',
        content: typeof resultContent === 'string'
          ? [{ type: 'text', text: resultContent || '(no output)' }]
          : resultContent,
        isError: result.isError ?? false,
        timestamp: 0,
      })
    }
  }

  return piContext(options, messages)
}
