import { describe, expect, it } from 'vitest'
import { AttachmentId, nativeFileModality } from '../src/index.ts'
import type { FileAttachmentRef } from '../src/index.ts'

function ref(name: string, mediaType: string): FileAttachmentRef {
  return {
    attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
    name,
    mediaType,
    bytes: 1,
  }
}

describe('nativeFileModality', () => {
  it('classifies catalog-native file media without treating ordinary documents as binary model input', () => {
    expect(nativeFileModality(ref('voice.bin', 'audio/mpeg'))).toBe('audio')
    expect(nativeFileModality(ref('clip.mp4', 'application/octet-stream'))).toBe('video')
    expect(nativeFileModality(ref('scan.pdf', 'application/octet-stream'))).toBe('pdf')
    expect(nativeFileModality(ref('brief.docx', 'application/octet-stream'))).toBeUndefined()
  })
})
