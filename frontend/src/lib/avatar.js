/* A picked profile picture → the small data URL the account keeps.
 *
 * The same rule as every other photo in the app (lib/media-ingest.js): decode the bytes, draw
 * them again on a canvas and encode the result, so EXIF, GPS and colour profiles never leave the
 * device. Avatars are shown at 34–56 CSS px, so the long edge is 192 px and the result is a few
 * kilobytes rather than the camera's original file. WebP is used when the browser really writes
 * it; Safari's PNG answer to a WebP request is retried as JPEG on white by encodeImage.
 */
import { imageDims, sniffKind } from './media-sniff.js'
import { MB, MAX_PHOTO_MP } from './media-limits.js'
import { t } from './i18n.js'

export const AVATAR_EDGE = 192
// Keep in step with api/avatar.js: 128 KiB decoded bytes and the data: prefix around them.
export const AVATAR_MAX_DATA_URL = 180 * 1024

const DATA_URL = /^data:image\/(?:webp|jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/

/** A stored value only if it can safely be put in an <img>; anything else falls back to initials. */
export function avatarSrc(value) {
  return typeof value === 'string' && value.length <= AVATAR_MAX_DATA_URL && DATA_URL.test(value) ? value : null
}

const failure = code => Object.assign(new Error(code), { code })

// Small enough for String.fromCharCode's argument limit; an avatar is far below it either way.
async function dataUrlOf(blob, mime) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return `data:${mime};base64,${btoa(binary)}`
}

/**
 * A picked File → `data:image/...;base64,...`, or throws { code: 'type' | 'too-large' |
 * 'photo-too-big' | 'unreadable' }. The ingest module is imported only when someone picks a
 * picture, so the canvas/decoder code does not make the Settings chunk larger for everyone.
 */
export async function makeAvatarDataUrl(file, { doc = globalThis.document } = {}) {
  if (!file) throw failure('type')
  if (file.size > 40 * MB) throw failure('too-large')
  const head = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer())
  const sniffed = sniffKind(head)
  if (!sniffed || sniffed.kind === 'video') throw failure('type')
  // A camera JPEG can carry its frame header behind a large maker-note block; read the rest only
  // for that case, exactly as lib/media-ingest.js does before it lets a photo near a decoder.
  let dims = imageDims(head)
  if (!dims && sniffed.mime === 'image/jpeg' && file.size > head.length) {
    dims = imageDims(new Uint8Array(await file.arrayBuffer()))
  }
  if (dims && dims.width * dims.height > MAX_PHOTO_MP * 1e6) throw failure('photo-too-big')
  const { decodeImage, encodeImage } = await import('./media-ingest.js')
  const pic = await decodeImage(file, sniffed.mime, { doc })
  try {
    for (const [edge, quality] of [[AVATAR_EDGE, 0.82], [160, 0.78], [128, 0.7]]) {
      const out = await encodeImage(pic, edge, quality, { doc })
      const url = await dataUrlOf(out.blob, out.mime)
      if (url.length <= AVATAR_MAX_DATA_URL) return url
    }
    throw failure('too-large')
  } finally {
    pic.close()
  }
}

/** The sentence for a refused avatar. Reuses the text the media pickers already use. */
export function avatarErrorText(error) {
  switch (error?.code) {
    case 'type':
    case 'unreadable':
    case 'avatar-invalid':
      return t('This browser cannot read that file.')
    case 'photo-too-big':
      return t('That photo is too large to process on this device.')
    case 'too-large':
    case 'avatar-too-large':
      return t('That picture is too big. Choose a smaller one.')
    default:
      return t('Something went wrong')
  }
}
