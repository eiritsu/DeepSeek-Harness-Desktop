import { Buffer } from 'node:buffer'
import { Context } from '@deepseek-ai/cordis'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type {
  AttachmentRecognizer, FileAttachmentRef, RecognizableAttachmentRef, StoredRecognizableAttachment,
} from '@deepseek-ai/dsh-attachment'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { zipSync, strToU8 } from 'fflate'
import { afterEach, describe, expect, it, vi } from 'vitest'

const officeParserMock = vi.hoisted(() => ({
  implementation: undefined as undefined | (() => Promise<string>),
}))

vi.mock('officeparser', async (importOriginal) => {
  const original = await importOriginal<typeof import('officeparser')>()
  return {
    ...original,
    parseOfficeAsync: (...args: Parameters<typeof original.parseOfficeAsync>) =>
      officeParserMock.implementation?.() ?? original.parseOfficeAsync(...args),
  }
})
import * as officeRecognizer from '../src/index.ts'
import { apply, inject, name } from '../src/index.ts'

afterEach(() => {
  officeParserMock.implementation = undefined
  vi.restoreAllMocks()
})

class MemorySettings extends SettingsProvider {
  private storedSettings: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.storedSettings))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.storedSettings = { ...this.storedSettings, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

function registered(config: Parameters<typeof apply>[1] = {}, apiKey?: string): AttachmentRecognizer {
  const registerRecognizer = vi.fn<(recognizer: AttachmentRecognizer) => () => void>(() => () => {})
  const ctx = {
    attachments: { registerRecognizer },
    effect: (install: () => () => void) => install(),
    inject: () => {},
    get: (service: string) => service === 'credentials' && apiKey !== undefined
      ? { resolve: () => Promise.resolve({ value: apiKey, source: 'test' }) }
      : undefined,
  } as unknown as Context
  apply(ctx, config)
  const recognizer = registerRecognizer.mock.calls[0]?.[0]
  if (recognizer === undefined) throw new Error('recognizer was not registered')
  return recognizer
}

function ref(name: string, mediaType = 'application/octet-stream'): FileAttachmentRef {
  return {
    attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
    bytes: 0,
    name,
    mediaType,
  }
}

function stored(attachment: RecognizableAttachmentRef, data: Uint8Array): StoredRecognizableAttachment {
  return {
    ref: attachment,
    data,
    ...(attachment.name === undefined ? {} : { name: attachment.name }),
    ...(attachment.mediaType === undefined ? {} : { mediaType: attachment.mediaType }),
  }
}

function docx(text: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': strToU8(`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`),
  })
}

describe('file-recognizer-office', () => {
  it('uses Loader-safe function exports and unregisters with its Cordis fiber', async () => {
    const ctx = new Context()
    const recognizers = new Set<AttachmentRecognizer>()
    ctx.provide('attachments', {
      registerRecognizer: (recognizer: AttachmentRecognizer) => {
        recognizers.add(recognizer)
        return () => { recognizers.delete(recognizer) }
      },
    } as never)
    const fiber = ctx.plugin({ name, inject: [...inject], apply }, {})
    await fiber.await()
    expect('default' in officeRecognizer).toBe(false)
    expect(recognizers.size).toBe(1)
    await fiber.dispose()
    expect(recognizers.size).toBe(0)
  })

  it('registers a live settings namespace and rejects unusable endpoint pairs', async () => {
    const ctx = new Context()
    ctx.provide('attachments', { registerRecognizer: () => () => {} } as never)
    await ctx.plugin(MemorySettings).await()
    await ctx.plugin({ name, inject: [...inject], apply }, {}).await()

    await expect(ctx.settings.update(officeRecognizer.FILE_RECOGNIZER_SETTINGS_NAMESPACE, {
      ocr: { endpoint: 'file:///tmp/ocr', model: 'ocr-model' },
    })).rejects.toThrow(/HTTP or HTTPS/)
    await expect(ctx.settings.update(officeRecognizer.FILE_RECOGNIZER_SETTINGS_NAMESPACE, {
      audioTranscription: { endpoint: 'https://audio.test/v1/audio/transcriptions' },
    })).rejects.toThrow(/requires both endpoint and model/)
    await expect(ctx.settings.update(officeRecognizer.FILE_RECOGNIZER_SETTINGS_NAMESPACE, {
      ocr: { model: 'ocr-model' },
    })).rejects.toThrow(/requires both endpoint and model/)
    await ctx.settings.update(officeRecognizer.FILE_RECOGNIZER_SETTINGS_NAMESPACE, {
      ocr: { endpoint: '', model: '' },
    })
    await ctx.settings.update(officeRecognizer.FILE_RECOGNIZER_SETTINGS_NAMESPACE, {
      videoUnderstanding: {
        endpoint: 'https://video.test/v1/chat/completions',
        model: 'video-model',
      },
    })
    expect(ctx.settings.describe().find(row => row.ns === officeRecognizer.FILE_RECOGNIZER_SETTINGS_NAMESPACE)?.value)
      .toMatchObject({ videoUnderstanding: { model: 'video-model' } })
    await ctx.fiber.dispose()
  })

  it('rejects invalid endpoint configuration at plugin load', () => {
    expect(() => registered({ ocr: { endpoint: 'https://vision.test' } }))
      .toThrow(/requires both endpoint and model/)
  })

  it('recognizes UTF-8 text by media type and caps recorded characters', async () => {
    const recognizer = registered({ maxExtractedChars: 4 })
    const attachment = ref('notes.unknown', 'text/plain')
    const result = await recognizer.recognize(stored(attachment, new TextEncoder().encode('abcdef')))
    expect(recognizer.supports(attachment)).toBe(true)
    expect(result?.text).toBe('abcd\n[attachment text truncated]')
  })

  it('recognizes Markdown when the browser reports a generic media type', async () => {
    const recognizer = registered()
    const attachment = ref('README.md')
    const result = await recognizer.recognize(stored(
      attachment,
      new TextEncoder().encode('# Harness\n\nMarkdown content.'),
    ))
    expect(recognizer.supports(attachment)).toBe(true)
    expect(result?.text).toBe('# Harness\n\nMarkdown content.')
  })

  it('handles attachments whose transport omitted the media type', async () => {
    const recognizer = registered()
    const { mediaType: _mediaType, ...attachment } = ref('README.md')
    expect(recognizer.supports(attachment)).toBe(true)
    await expect(recognizer.recognize(stored(
      attachment,
      new TextEncoder().encode('# Harness'),
    ))).resolves.toEqual({ text: '# Harness' })
  })

  it('recognizes JSON documents by filename when the browser reports application/json', async () => {
    const recognizer = registered()
    const attachment = ref('settings.json', 'application/json')
    const result = await recognizer.recognize(stored(
      attachment,
      new TextEncoder().encode('{"enabled":true}'),
    ))
    expect(recognizer.supports(attachment)).toBe(true)
    expect(result?.text).toBe('{"enabled":true}')
  })

  it('extracts text from a bounded DOCX archive', async () => {
    const recognizer = registered()
    const attachment = ref('brief.docx')
    const data = docx('Hello DSH')
    const result = await recognizer.recognize(stored(attachment, data))
    expect(result?.text).toContain('Hello DSH')
  })

  it('refuses archives and inputs outside configured resource limits', async () => {
    const data = docx('bounded')
    const attachment = ref('brief.docx')
    await expect(registered({ maxZipEntries: 1 }).recognize(stored(attachment, data)))
      .resolves.toBeUndefined()
    await expect(registered({ maxInputBytes: 1 }).recognize(stored(attachment, data)))
      .resolves.toBeUndefined()
  })

  it('declines unsupported and malformed formats without inventing text', async () => {
    const recognizer = registered()
    expect(recognizer.supports(ref('archive.rar'))).toBe(false)
    const broken = ref('broken.docx')
    await expect(recognizer.recognize(stored(
      broken,
      new Uint8Array(Buffer.from('not a zip')),
    ))).resolves.toBeUndefined()
  })

  it('sends OpenAI-compatible audio transcription with the configured credential', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ text: 'spoken words' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    const recognizer = registered({
      audioTranscription: {
        endpoint: 'https://audio.test/v1',
        model: 'whisper-large',
        apiKeyEnv: 'DEEPSEEK_FILES_AUDIO_API_KEY',
      },
    }, 'audio-secret')
    const attachment = ref('sample.mp3', 'audio/mpeg')

    await expect(recognizer.recognize(stored(attachment, new Uint8Array([1, 2, 3]))))
      .resolves.toEqual({ text: 'spoken words' })
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('https://audio.test/v1/audio/transcriptions')
    expect(init?.headers).toEqual({ authorization: 'Bearer audio-secret' })
    expect(init?.body).toBeInstanceOf(FormData)
    expect((init?.body as FormData).get('model')).toBe('whisper-large')
  })

  it.each([
    ['ocr', 'scan.png', 'image/png', 'ocr-model', 'image_url', 'https://openrouter.ai/api/v1', 'https://openrouter.ai/api/v1/chat/completions'],
    ['videoUnderstanding', 'clip.mp4', 'video/mp4', 'video-model', 'video_url', 'https://vision.test/v1/chat/completions', 'https://vision.test/v1/chat/completions'],
  ] as const)('sends %s files through chat-completions content', async (
    kind,
    filename,
    mediaType,
    model,
    contentType,
    endpoint,
    expectedUrl,
  ) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ choices: [{ message: { content: 'recognized content' } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    const recognizer = registered({
      [kind]: { endpoint, model },
    })
    const attachment = ref(filename, mediaType)

    await expect(recognizer.recognize(stored(attachment, new Uint8Array([4, 5, 6]))))
      .resolves.toEqual({ text: 'recognized content' })
    expect(fetchMock.mock.calls[0]?.[0]).toBe(expectedUrl)
    const requestBody = fetchMock.mock.calls[0]?.[1]?.body
    expect(typeof requestBody).toBe('string')
    if (typeof requestBody !== 'string') throw new TypeError('expected a JSON request body')
    const body = JSON.parse(requestBody) as {
      model: string
      messages: Array<{ content: Array<{ type: string }> }>
    }
    expect(body.model).toBe(model)
    expect(body.messages[0]?.content[1]?.type).toBe(contentType)
  })

  it('matches configured media providers by either MIME type or filename', () => {
    const recognizer = registered({
      ocr: { endpoint: 'https://vision.test/v1', model: 'vision' },
      audioTranscription: { endpoint: 'https://audio.test/v1', model: 'audio' },
      videoUnderstanding: { endpoint: 'https://video.test/v1', model: 'video' },
    })
    for (const attachment of [
      ref('scan.bin', 'image/png'),
      ref('scan.JPEG'),
      ref('voice.bin', 'audio/wav'),
      ref('voice.ogg'),
      ref('clip.bin', 'video/quicktime'),
      ref('clip.mkv'),
      ref('slides.PPTX'),
      ref('source.ts'),
    ]) expect(recognizer.supports(attachment)).toBe(true)
    const anonymous = {
      attachmentId: AttachmentId(`sha256:${'b'.repeat(64)}`),
      bytes: 0,
      mediaType: 'image/png',
      width: 1,
      height: 1,
    } as const
    expect(recognizer.supports(anonymous)).toBe(true)
  })

  it('declines empty text and rejects invalid UTF-8 or an already-aborted request', async () => {
    const recognizer = registered()
    await expect(recognizer.recognize(stored(ref('empty.txt'), new Uint8Array())))
      .resolves.toBeUndefined()
    await expect(recognizer.recognize(stored(ref('invalid.txt'), new Uint8Array([0xff]))))
      .rejects.toThrow()
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await expect(recognizer.recognize(stored(ref('text.txt'), new TextEncoder().encode('text')), controller.signal))
      .rejects.toThrow('cancelled')
  })

  it('applies both archive byte and entry limits and declines unsupported recognition', async () => {
    const data = docx('bounded')
    await expect(registered({ maxUncompressedBytes: 1 }).recognize(stored(ref('brief.docx'), data)))
      .resolves.toBeUndefined()
    await expect(registered().recognize(stored(ref('archive.rar'), data)))
      .resolves.toBeUndefined()
  })

  it('routes MP4 audio MIME through transcription instead of video understanding', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ transcript: 'audio transcript' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    const recognizer = registered({
      audioTranscription: { endpoint: 'https://audio.test/transcribe', model: 'audio' },
      videoUnderstanding: { endpoint: 'https://video.test/chat', model: 'video' },
    })
    const signal = new AbortController().signal
    await expect(recognizer.recognize(stored(ref('meeting.mp4', 'audio/mp4'), new Uint8Array([1])), signal))
      .resolves.toEqual({ text: 'audio transcript' })
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://audio.test/transcribe')
  })

  it('supports generic image files and multipart chat text responses', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: [{ text: 'first' }, null, { text: 2 }, { text: 'second' }] } }],
    }), { status: 200 }))
    const recognizer = registered({
      ocr: { endpoint: 'https://vision.test/chat', model: 'vision', apiKeyEnv: 'MISSING_KEY' },
    })
    await expect(recognizer.recognize(stored(ref('scan.bmp'), new Uint8Array([1, 2]))))
      .resolves.toEqual({ text: 'first\nsecond' })
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({ 'content-type': 'application/json' })
  })

  it.each([
    [{ text: 'direct' }, 'direct'],
    [{ output_text: 'output' }, 'output'],
    [{ choices: [{ message: { content: 'message' } }] }, 'message'],
  ] as const)('accepts supported provider response %j', async (payload, expected) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }))
    const recognizer = registered({
      videoUnderstanding: { endpoint: 'https://video.test/chat', model: 'video' },
    })
    await expect(recognizer.recognize(stored(ref('clip.mov'), new Uint8Array([1]))))
      .resolves.toEqual({ text: expected })
  })

  it('reports provider HTTP failures and empty response bodies', async () => {
    for (const response of [
      new Response('{}', { status: 503 }),
      new Response('{}', { status: 200 }),
      new Response(JSON.stringify({ choices: [] }), { status: 200 }),
      new Response(JSON.stringify({ choices: [null] }), { status: 200 }),
      new Response(JSON.stringify({ choices: [{ message: null }] }), { status: 200 }),
      new Response(JSON.stringify({ choices: [{ message: { content: [] } }] }), { status: 200 }),
    ]) {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response)
      const recognizer = registered({
        ocr: { endpoint: 'https://vision.test/chat', model: 'vision' },
      })
      await expect(recognizer.recognize(stored(ref('scan.png'), new Uint8Array([1])))).rejects.toThrow()
      vi.restoreAllMocks()
    }
  })

  it('reports audio HTTP and empty-transcript failures', async () => {
    for (const response of [
      new Response('{}', { status: 401 }),
      new Response(JSON.stringify({ text: '' }), { status: 200 }),
    ]) {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response)
      const recognizer = registered({
        audioTranscription: { endpoint: 'https://audio.test/transcribe', model: 'audio' },
      })
      const { name: _name, ...anonymous } = stored(ref('voice.wav', ''), new Uint8Array([1]))
      await expect(recognizer.recognize(anonymous)).rejects.toThrow()
      vi.restoreAllMocks()
    }
  })

  it('rethrows malformed PDF and configured media failures but declines malformed office archives', async () => {
    const data = new Uint8Array(Buffer.from('not a document'))
    await expect(registered().recognize(stored(ref('broken.pdf'), data))).rejects.toThrow()
    await expect(registered().recognize(stored(ref('broken.odt'), data))).resolves.toBeUndefined()
    const failedFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('provider unavailable'))
    const configured = registered({
      ocr: { endpoint: 'https://vision.test/chat', model: 'vision' },
      audioTranscription: { endpoint: 'https://audio.test/transcribe', model: 'audio' },
      videoUnderstanding: { endpoint: 'https://video.test/chat', model: 'video' },
    })
    for (const attachment of [ref('image.tif'), ref('audio.flac'), ref('video.avi')]) {
      await expect(configured.recognize(stored(attachment, new Uint8Array([1]))))
        .rejects.toThrow('provider unavailable')
    }
    expect(failedFetch).toHaveBeenCalledTimes(3)
  })

  it('declines matching media when its external recognizer is not configured', async () => {
    const recognizer = registered()
    const { mediaType: _mediaType, ...imageRef } = ref('image.png')
    await expect(recognizer.recognize(stored(imageRef, new Uint8Array([1]))))
      .resolves.toBeUndefined()
    await expect(recognizer.recognize({ ref: ref('voice.wav'), data: new Uint8Array([1]), name: 'voice.wav' }))
      .resolves.toBeUndefined()
    await expect(recognizer.recognize({ ref: ref('clip.mov'), data: new Uint8Array([1]), name: 'clip.mov' }))
      .resolves.toBeUndefined()
    expect(recognizer.supports(ref('README'))).toBe(false)
  })

  it('uses safe anonymous file metadata for external providers', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ text: 'anonymous image' }),
      { status: 200 },
    ))
    const recognizer = registered({
      ocr: { endpoint: 'https://vision.test/chat', model: 'vision' },
    })
    const signal = new AbortController().signal
    const { mediaType: _mediaType, ...imageRef } = ref('scan.png')
    await expect(recognizer.recognize(stored(imageRef, new Uint8Array([1])), signal))
      .resolves.toEqual({ text: 'anonymous image' })

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ text: 'anonymous image' }), { status: 200 }))
    const anonymous = {
      attachmentId: AttachmentId(`sha256:${'b'.repeat(64)}`),
      bytes: 1,
      mediaType: 'image/png',
      width: 1,
      height: 1,
    } as const
    await expect(recognizer.recognize(stored(anonymous, new Uint8Array([1])), signal))
      .resolves.toEqual({ text: 'anonymous image' })
    const requestBody = fetchMock.mock.calls[1]?.[1]?.body
    expect(typeof requestBody).toBe('string')
    if (typeof requestBody !== 'string') throw new Error('expected JSON request body')
    const body = JSON.parse(requestBody) as {
      messages: Array<{ content: Array<{ file?: { filename: string } }> }>
    }
    expect(body.messages[0]?.content[1]?.file).toBeUndefined()
  })

  it('uses fallback audio metadata when the transport omits MIME type', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ text: 'audio' }),
      { status: 200 },
    ))
    const recognizer = registered({
      audioTranscription: { endpoint: 'https://audio.test/transcribe', model: 'audio' },
    })
    const { mediaType: _mediaType, ...voiceRef } = ref('voice.wav')
    await expect(recognizer.recognize({ ref: voiceRef, data: new Uint8Array([1]), name: 'voice.wav' }))
      .resolves.toEqual({ text: 'audio' })
    const form = fetchMock.mock.calls[0]?.[1]?.body as FormData
    const file = form.get('file') as File
    expect(file.type).toBe('application/octet-stream')
    expect(file.name).toBe('voice.wav')

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ text: 'anonymous audio' }), { status: 200 }))
    const audioRef = ref('audio', 'audio/wav')
    await expect(recognizer.recognize({ ref: audioRef, data: new Uint8Array([2]), name: 'audio' }))
      .resolves.toEqual({ text: 'anonymous audio' })
    const anonymousForm = fetchMock.mock.calls[1]?.[1]?.body as FormData
    expect((anonymousForm.get('file') as File).name).toBe('audio')
  })

  it('uses generic MIME metadata for filename-routed video recognition', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ text: 'video' }),
      { status: 200 },
    ))
    const recognizer = registered({
      videoUnderstanding: { endpoint: 'https://video.test/chat', model: 'video' },
    })
    await expect(recognizer.recognize({ ref: ref('clip.mov'), data: new Uint8Array([1]), name: 'clip.mov' }))
      .resolves.toEqual({ text: 'video' })
    const body = fetchMock.mock.calls[0]?.[1]?.body
    expect(typeof body).toBe('string')
    if (typeof body !== 'string') throw new Error('expected JSON request body')
    expect(body).toContain('data:application/octet-stream;base64,')
  })

  it('rejects primitive, empty-string, and invalid content response payloads', async () => {
    for (const payload of [
      null,
      'text',
      { choices: [{ message: { content: '' } }] },
      { choices: [{ message: { content: 42 } }] },
      { choices: [{ message: { content: [null, { text: 42 }] } }] },
    ]) {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }))
      const recognizer = registered({
        ocr: { endpoint: 'https://vision.test/chat', model: 'vision' },
      })
      await expect(recognizer.recognize(stored(ref('scan.png'), new Uint8Array([1])))).rejects.toThrow(/no recognized text/)
      vi.restoreAllMocks()
    }
  })

  it('falls back from an empty PDF parse to configured OCR', async () => {
    officeParserMock.implementation = async () => ''
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ text: 'OCR PDF' }), { status: 200 }))
    const recognizer = registered({
      ocr: { endpoint: 'https://vision.test/chat', model: 'vision' },
    })
    await expect(recognizer.recognize(stored(ref('empty.pdf'), new Uint8Array([1]))))
      .resolves.toEqual({ text: 'OCR PDF' })

    officeParserMock.implementation = async () => ''
    await expect(registered().recognize(stored(ref('empty.pdf'), new Uint8Array([1]))))
      .resolves.toBeUndefined()
  })

  it('rechecks cancellation after document parsing', async () => {
    const controller = new AbortController()
    officeParserMock.implementation = async () => {
      controller.abort(new Error('cancelled after parse'))
      return 'parsed'
    }
    await expect(registered().recognize(stored(ref('brief.pdf'), new Uint8Array([1])), controller.signal))
      .rejects.toThrow('cancelled after parse')
  })

  it('declines a structurally valid archive that officeparser cannot interpret', async () => {
    const malformed = zipSync({ 'unknown.xml': strToU8('<unknown/>') })
    await expect(registered().recognize(stored(ref('broken.docx'), malformed)))
      .resolves.toBeUndefined()
  })
})
