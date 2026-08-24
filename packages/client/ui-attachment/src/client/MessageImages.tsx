import type { MessageImagesProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ImageGallery } from '../MessageImage.tsx'
import { messageImageLabels } from './labels.ts'
import css from './MessageFiles.module.css'

/** Historical message-image slot entry. */
export function MessageImages({ images, files, loadImage, align, t }: MessageImagesProps) {
  return (
    <div className={css.group} data-align={align}>
      {images.length > 0 && <ImageGallery images={images} load={loadImage} align={align} labels={messageImageLabels(t)} />}
      {files.map(({ attachment }) => (
        <button
          key={String(attachment.attachmentId)}
          type="button"
          className={css.file}
          onClick={() => {
            void loadImage(attachment).then((url) => {
              const anchor = document.createElement('a')
              anchor.href = url
              anchor.download = attachment.name ?? 'attachment'
              anchor.click()
            })
          }}
        >
          <span className={css.glyph} aria-hidden />
          <span className={css.text}>
            <span className={css.name}>{attachment.name ?? t('file.pending')}</span>
            <span className={css.meta}>{attachment.mediaType} · {attachment.bytes} B</span>
          </span>
        </button>
      ))}
    </div>
  )
}
