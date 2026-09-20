/** Sideloadable semantic recognition for common document attachments. */

import { Buffer } from 'node:buffer'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { AttachmentRecognizer, FileAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import type { Canvas, SKRSContext2D } from '@napi-rs/canvas'
import { parseOfficeAsync } from 'officeparser'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import yauzl from 'yauzl'
import type { Entry } from 'yauzl'

type RecognizerFile = { data: Uint8Array; mediaType?: string; name?: string }
type ConfiguredRecognitionEndpoint = RecognitionEndpointConfig & { endpoint: string; model: string }
type PdfCanvas = { canvas: Canvas; context: SKRSContext2D }
type PdfCanvasFactory = {
  create: (width: number, height: number) => PdfCanvas
  destroy: (target: PdfCanvas) => void
}

const OFFICE_EXTENSIONS = new Set(['docx', 'pptx', 'xlsx', 'odt', 'odp', 'ods', 'pdf'])
const ZIP_OFFICE_EXTENSIONS = new Set(['docx', 'pptx', 'xlsx', 'odt', 'odp', 'ods'])
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff'])
const SVG_EXTENSIONS = new Set(['svg'])
const DESIGN_EXTENSIONS = new Set(['psd', 'ai', 'eps', 'indd', 'sketch', 'dxf', 'dwg', 'rvt'])
const DESIGN_MEDIA_TYPES = new Set([
  'image/vnd.adobe.photoshop', 'image/x-photoshop', 'application/postscript',
  'application/illustrator', 'application/vnd.adobe.illustrator',
])
const AUDIO_EXTENSIONS = new Set(['mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'wav', 'webm', 'flac', 'ogg', 'oga'])
const VIDEO_EXTENSIONS = new Set(['mp4', 'mpeg', 'mpg', 'mov', 'webm', 'mkv', 'avi', 'm4v'])
const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'mdx', 'markdown', 'rst', 'csv', 'tsv', 'json', 'jsonl', 'yaml', 'yml', 'xml',
  'toml', 'ini', 'env', 'conf', 'config', 'properties', 'log', 'ts', 'tsx', 'js', 'jsx',
  'mjs', 'cjs', 'css', 'scss', 'less', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h',
  'cpp', 'hpp', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'sql', 'graphql',
])

/** One external recognition endpoint configured from Settings. */
export interface RecognitionEndpointConfig {
  /** Complete request URL. */
  endpoint?: string
  /** Provider model identifier. */
  model?: string
  /** Credential reference resolved immediately before each request. */
  apiKeyEnv?: string
}

/** Deepseek-Files recognition plugin configuration. */
export interface Config {
  /** Maximum input bytes parsed by this recognizer. Default: 32 MiB. */
  maxInputBytes?: number
  /** Maximum extracted characters recorded in one file block. Default: 200,000. */
  maxExtractedChars?: number
  /** Maximum total uncompressed archive bytes. Default: 128 MiB. */
  maxUncompressedBytes?: number
  /** Maximum archive entries. Default: 4,000. */
  maxZipEntries?: number
  /** Maximum PDF pages sent through OCR. Default: 20. */
  maxPdfOcrPages?: number
  /** Maximum pixels rendered for one PDF page. Default: 4,000,000. */
  maxPdfPagePixels?: number
  /** Maximum scale used while rasterizing one PDF page. Default: 2. */
  maxPdfRenderScale?: number
  /** OpenAI-compatible OCR endpoint. */
  ocr?: RecognitionEndpointConfig
  /** OpenAI-compatible audio transcription endpoint. */
  audioTranscription?: RecognitionEndpointConfig
  /** OpenAI-compatible video understanding endpoint. */
  videoUnderstanding?: RecognitionEndpointConfig
}

const recognitionEndpointConfig: z<RecognitionEndpointConfig> = z.object({
  endpoint: z.string(),
  model: z.string(),
  apiKeyEnv: z.string().role('credential-ref'),
})

export const Config: z<Config> = z.object({
  maxInputBytes: z.number().step(1).min(1).default(32 * 1024 * 1024),
  maxExtractedChars: z.number().step(1).min(1).default(200_000),
  maxUncompressedBytes: z.number().step(1).min(1).default(128 * 1024 * 1024),
  maxZipEntries: z.number().step(1).min(1).default(4_000),
  maxPdfOcrPages: z.number().step(1).min(1).default(20),
  maxPdfPagePixels: z.number().step(1).min(1).default(4_000_000),
  maxPdfRenderScale: z.number().min(0.1).default(2),
  ocr: recognitionEndpointConfig,
  audioTranscription: recognitionEndpointConfig,
  videoUnderstanding: recognitionEndpointConfig,
})

/** Cordis plugin name. */
export const name = 'file-recognizer-office'
/** Services required by the recognition provider. */
export const inject = ['attachments']

/** Settings namespace for external file-recognition providers. */
export const FILE_RECOGNIZER_SETTINGS_NAMESPACE = 'file-recognizer-office' as SettingsNamespace

/** Credential references used by the Deepseek-Files settings page. */
export const FILE_RECOGNIZER_CREDENTIAL_REFS = {
  ocr: 'DEEPSEEK_FILES_OCR_API_KEY',
  audioTranscription: 'DEEPSEEK_FILES_AUDIO_API_KEY',
  videoUnderstanding: 'DEEPSEEK_FILES_VIDEO_API_KEY',
} as const

function validateConfig(config: Config): void {
  for (const [name, endpoint] of Object.entries({
    ocr: config.ocr,
    audioTranscription: config.audioTranscription,
    videoUnderstanding: config.videoUnderstanding,
  })) {
    if (endpoint === undefined) continue
    const endpointUrl = endpoint.endpoint
    const model = endpoint.model
    if (endpointUrl === undefined || endpointUrl.length === 0) {
      if (model !== undefined && model.length > 0) throw new TypeError(`${name} requires both endpoint and model`)
      continue
    }
    if (model === undefined || model.length === 0) throw new TypeError(`${name} requires both endpoint and model`)
    const protocol = new URL(endpointUrl).protocol
    if (protocol !== 'http:' && protocol !== 'https:') {
      throw new TypeError(`${name} endpoint must use HTTP or HTTPS`)
    }
  }
}

function extension(file: { name?: string }): string | undefined {
  const name = file.name
  if (name === undefined) return undefined
  const index = name.lastIndexOf('.')
  return index < 0 ? undefined : name.slice(index + 1).toLowerCase()
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text
  return text.slice(0, limit) + '\n[attachment text truncated]'
}

function isSvg(file: { mediaType?: string; name?: string }): boolean {
  const suffix = extension(file)
  return file.mediaType === 'image/svg+xml' || suffix !== undefined && SVG_EXTENSIONS.has(suffix)
}

function isRasterImage(file: { mediaType?: string; name?: string }): boolean {
  const suffix = extension(file)
  if (file.mediaType === 'image/svg+xml' || suffix === 'svg') return false
  if (suffix !== undefined && DESIGN_EXTENSIONS.has(suffix)) return false
  if (file.mediaType !== undefined && DESIGN_MEDIA_TYPES.has(file.mediaType)) return false
  return file.mediaType?.startsWith('image/') === true
    || suffix !== undefined && IMAGE_EXTENSIONS.has(suffix)
}

function decodeSvg(data: Uint8Array): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data) || undefined
  } catch {
    // Invalid UTF-8 remains available as a generic attachment.
    return undefined
  }
}

function configured(endpoint: RecognitionEndpointConfig | undefined): endpoint is ConfiguredRecognitionEndpoint {
  return endpoint?.endpoint !== undefined && endpoint.endpoint.length > 0
    && endpoint.model !== undefined && endpoint.model.length > 0
}

function operationEndpoint(config: ConfiguredRecognitionEndpoint, operation: string): string {
  const endpoint = new URL(config.endpoint)
  const path = endpoint.pathname.replace(/\/+$/, '')
  if (/\/(?:api\/)?v\d+(?:\.\d+)?$/.test(path)) endpoint.pathname = `${path}/${operation}`
  return endpoint.toString()
}

async function authorizationHeaders(ctx: Context, config: RecognitionEndpointConfig): Promise<Record<string, string>> {
  if (config.apiKeyEnv === undefined || config.apiKeyEnv.length === 0) return {}
  const key = await ctx.get('credentials')?.resolve(credentialRef(config.apiKeyEnv))
  return key === undefined ? {} : { authorization: `Bearer ${key.value}` }
}

function responseText(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  for (const key of ['text', 'transcript', 'output_text']) {
    if (typeof record[key] === 'string' && record[key].length > 0) return record[key]
  }
  const choices = record.choices
  if (!Array.isArray(choices)) return undefined
  const first: unknown = choices[0]
  if (typeof first !== 'object' || first === null) return undefined
  const message = (first as Record<string, unknown>).message
  if (typeof message !== 'object' || message === null) return undefined
  const content = (message as Record<string, unknown>).content
  if (typeof content === 'string') return content.length === 0 ? undefined : content
  if (!Array.isArray(content)) return undefined
  const text = content.flatMap((part) => {
    if (typeof part !== 'object' || part === null) return []
    const candidate = (part as Record<string, unknown>).text
    return typeof candidate === 'string' ? [candidate] : []
  }).join('\n')
  return text.length === 0 ? undefined : text
}

async function recognizeChatFile(
  ctx: Context,
  file: RecognizerFile,
  config: RecognitionEndpointConfig,
  kind: 'ocr' | 'video',
  signal: AbortSignal | undefined,
): Promise<string | undefined> {
  if (!configured(config)) return undefined
  const mediaType = file.mediaType ?? 'application/octet-stream'
  const dataURL = `data:${mediaType};base64,${Buffer.from(file.data).toString('base64')}`
  const filename = file.name ?? `attachment.${extension(file) ?? 'bin'}`
  const media = kind === 'video'
    ? { type: 'video_url', video_url: { url: dataURL } }
    : mediaType.startsWith('image/')
      ? { type: 'image_url', image_url: { url: dataURL } }
      : { type: 'file', file: { filename, file_data: dataURL } }
  const response = await fetch(operationEndpoint(config, 'chat/completions'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...await authorizationHeaders(ctx, config),
    },
    body: JSON.stringify({
      model: config.model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: kind === 'ocr' ? 'Extract all visible text verbatim.' : 'Describe and transcribe the important content of this video.' },
          media,
        ],
      }],
    }),
    ...(signal === undefined ? {} : { signal }),
  })
  if (!response.ok) throw new Error(`Deepseek-Files ${kind} service returned HTTP ${response.status} for model ${config.model}. Check the configured endpoint, model and API key.`)
  const text = responseText(await response.json())
  if (text === undefined) throw new Error(`Deepseek-Files ${kind} service returned no recognized text for model ${config.model}.`)
  return text
}

async function recognizePdf(
  ctx: Context,
  file: RecognizerFile,
  config: Config,
  signal: AbortSignal | undefined,
): Promise<string | undefined> {
  const ocr = config.ocr ?? {}
  if (!configured(ocr)) return undefined
  const maxPages = config.maxPdfOcrPages ?? 20
  const maxPixels = config.maxPdfPagePixels ?? 4_000_000
  const maxScale = config.maxPdfRenderScale ?? 2
  const loadingTask = getDocument({
    data: Uint8Array.from(file.data),
    useWorkerFetch: false,
  })
  try {
    const document = await loadingTask.promise
    const canvasFactory = document.canvasFactory as PdfCanvasFactory
    const pageCount = Math.min(document.numPages, maxPages)
    const recognized: string[] = []
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      signal?.throwIfAborted()
      const page = await document.getPage(pageNumber)
      const base = page.getViewport({ scale: 1 })
      const scale = Math.min(maxScale, Math.sqrt(maxPixels / (base.width * base.height)))
      const viewport = page.getViewport({ scale })
      const target = canvasFactory.create(Math.ceil(viewport.width), Math.ceil(viewport.height))
      try {
        // PDF.js' public browser declaration names a DOM context, while its Node factory returns a napi-rs context.
        await page.render({
          canvas: null,
          canvasContext: target.context as unknown as CanvasRenderingContext2D,
          viewport,
        }).promise
        const png = target.canvas.toBuffer('image/png')
        const text = await recognizeChatFile(ctx, {
          data: png,
          mediaType: 'image/png',
          name: `${file.name ?? 'attachment.pdf'}#page-${String(pageNumber)}.png`,
        }, ocr, 'ocr', signal)
        if (text !== undefined) recognized.push(`[PDF page ${String(pageNumber)}]\n${text}`)
      } finally {
        canvasFactory.destroy(target)
      }
    }
    if (document.numPages > pageCount) {
      recognized.push(`[PDF OCR limited to first ${String(pageCount)} of ${String(document.numPages)} pages]`)
    }
    return recognized.length === 0 ? undefined : recognized.join('\n\n')
  } finally {
    await loadingTask.destroy()
  }
}

async function transcribeAudio(
  ctx: Context,
  file: RecognizerFile & FileAttachmentRef,
  config: RecognitionEndpointConfig,
  signal: AbortSignal | undefined,
): Promise<string | undefined> {
  if (!configured(config)) return undefined
  const form = new FormData()
  form.set('model', config.model)
  form.set('file', new File([Uint8Array.from(file.data).buffer], file.name, { type: file.mediaType || 'application/octet-stream' }))
  const response = await fetch(operationEndpoint(config, 'audio/transcriptions'), {
    method: 'POST',
    headers: await authorizationHeaders(ctx, config),
    body: form,
    ...(signal === undefined ? {} : { signal }),
  })
  if (!response.ok) throw new Error(`Deepseek-Files audio service returned HTTP ${response.status} for model ${config.model}. Check the configured endpoint, model and API key.`)
  const text = responseText(await response.json())
  if (text === undefined) throw new Error(`Deepseek-Files audio service returned no transcript for model ${config.model}.`)
  return text
}

async function preflightZip(data: Uint8Array, maxEntries: number, maxBytes: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    yauzl.fromBuffer(Buffer.from(data), { lazyEntries: true }, (error, archive) => {
      if (error !== null) {
        resolve(false)
        return
      }
      let entries = 0
      let bytes = 0
      let settled = false
      const finish = (accepted: boolean): void => {
        /* v8 ignore next -- yauzl may race its error and end events, while either deterministic test trigger removes the other. */
        if (settled) return
        settled = true
        resolve(accepted)
      }
      const refuse = (): void => {
        archive.close()
        finish(false)
      }
      archive.on('error', refuse)
      archive.on('entry', (entry: Entry) => {
        entries += 1
        bytes += entry.uncompressedSize
        if (entries > maxEntries || bytes > maxBytes) {
          refuse()
          return
        }
        archive.readEntry()
      })
      archive.on('end', () => { finish(true) })
      archive.readEntry()
    })
  })
}

/** Register the common-document recognizer into the mounted attachment store. */
export function apply(ctx: Context, config: Config): void {
  validateConfig(config)
  let current: () => Config = () => config
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, FILE_RECOGNIZER_SETTINGS_NAMESPACE, Config, config, {
      setSource: (source) => { current = source },
      onChange: () => {},
      validate: validateConfig,
    })
  })
  const maxInputBytes = config.maxInputBytes ?? 32 * 1024 * 1024
  const maxExtractedChars = config.maxExtractedChars ?? 200_000
  const maxUncompressedBytes = config.maxUncompressedBytes ?? 128 * 1024 * 1024
  const maxZipEntries = config.maxZipEntries ?? 4_000
  const recognizer = {
    id: 'officeparser',
    priority: 100,
    maxInputBytes,
    supports: (file) => {
      const suffix = extension(file)
      const settings = current()
      const mediaType = file.mediaType ?? ''
      return isSvg(file)
        || mediaType.startsWith('text/')
        || (suffix !== undefined && (OFFICE_EXTENSIONS.has(suffix) || TEXT_EXTENSIONS.has(suffix)))
        || (configured(settings.ocr) && isRasterImage(file))
        || (configured(settings.audioTranscription)
          && ((file.mediaType ?? '').startsWith('audio/') || (suffix !== undefined && AUDIO_EXTENSIONS.has(suffix))))
        || (configured(settings.videoUnderstanding)
          && ((file.mediaType ?? '').startsWith('video/') || (suffix !== undefined && VIDEO_EXTENSIONS.has(suffix))))
    },
    recognize: async (file, signal) => {
      signal?.throwIfAborted()
      if (file.data.byteLength > maxInputBytes) return undefined
      const input: RecognizerFile = { ...file.ref, data: file.data }
      const mediaType = input.mediaType ?? ''
      const suffix = extension(input)
      const settings = current()
      if (isSvg(input)) {
        const text = decodeSvg(file.data)
        return text === undefined ? undefined : { text: truncate(text, maxExtractedChars) }
      }
      if (mediaType.startsWith('text/') || (suffix !== undefined && TEXT_EXTENSIONS.has(suffix))) {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(file.data)
        return text === '' ? undefined : { text: truncate(text, maxExtractedChars) }
      }
      try {
        if (mediaType.startsWith('video/')
          || (!mediaType.startsWith('audio/') && suffix !== undefined && VIDEO_EXTENSIONS.has(suffix))) {
          const text = await recognizeChatFile(ctx, input, settings.videoUnderstanding ?? {}, 'video', signal)
          return text === undefined ? undefined : { text: truncate(text, maxExtractedChars) }
        }
        if (mediaType.startsWith('audio/') || (suffix !== undefined && AUDIO_EXTENSIONS.has(suffix))) {
          // Image references cannot satisfy audio routing; durable file references always carry a name.
          const text = await transcribeAudio(ctx, input as RecognizerFile & FileAttachmentRef, settings.audioTranscription ?? {}, signal)
          return text === undefined ? undefined : { text: truncate(text, maxExtractedChars) }
        }
        if (isRasterImage(input)) {
          const text = await recognizeChatFile(ctx, input, settings.ocr ?? {}, 'ocr', signal)
          return text === undefined ? undefined : { text: truncate(text, maxExtractedChars) }
        }
        if (suffix === undefined || !OFFICE_EXTENSIONS.has(suffix)) return undefined
        if (ZIP_OFFICE_EXTENSIONS.has(suffix)
          && !await preflightZip(file.data, maxZipEntries, maxUncompressedBytes)) return undefined
        let text = (await parseOfficeAsync(Buffer.from(file.data), {
          outputErrorToConsole: false,
        })).trim()
        if (text === '' && suffix === 'pdf') {
          text = await recognizePdf(ctx, input, settings, signal) ?? ''
        }
        signal?.throwIfAborted()
        return text === '' ? undefined : { text: truncate(text, maxExtractedChars) }
      } catch (error) {
        signal?.throwIfAborted()
        if (isRasterImage(input) || mediaType.startsWith('audio/') || mediaType.startsWith('video/')
          || (suffix !== undefined && (AUDIO_EXTENSIONS.has(suffix) || VIDEO_EXTENSIONS.has(suffix) || suffix === 'pdf'))) throw error
        return undefined
      }
    },
  } satisfies AttachmentRecognizer & { priority: number }
  ctx.effect(() => ctx.attachments.registerRecognizer(recognizer), 'file-recognizer-office registration')
}
