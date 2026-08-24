/** Attachment media classification for provider-native model input. */

import type { FileAttachmentRef } from './types.ts'

const AUDIO_EXTENSIONS = new Set(['mp3', 'mpga', 'm4a', 'wav', 'flac', 'ogg', 'oga'])
const VIDEO_EXTENSIONS = new Set(['mp4', 'mpeg', 'mpg', 'mov', 'webm', 'mkv', 'avi', 'm4v'])

/** Generic-file modalities that model catalogs can declare directly. */
export type NativeFileModality = 'audio' | 'video' | 'pdf'

function extension(name: string | undefined): string | undefined {
  if (name === undefined) return undefined
  const index = name.lastIndexOf('.')
  return index < 0 ? undefined : name.slice(index + 1).toLowerCase()
}

/**
 * Classify one generic file into a provider-native model modality.
 * @param ref - durable generic-file reference.
 * @returns the exact catalog modality, or `undefined` for locally parsed and unknown formats.
 */
export function nativeFileModality(ref: FileAttachmentRef): NativeFileModality | undefined {
  if (ref.mediaType === 'application/pdf') return 'pdf'
  if (ref.mediaType.startsWith('audio/')) return 'audio'
  if (ref.mediaType.startsWith('video/')) return 'video'
  const suffix = extension(ref.name)
  if (suffix === 'pdf') return 'pdf'
  if (suffix !== undefined && AUDIO_EXTENSIONS.has(suffix)) return 'audio'
  if (suffix !== undefined && VIDEO_EXTENSIONS.has(suffix)) return 'video'
  return undefined
}
