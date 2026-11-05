/* Profile pictures: a small, self-contained data URL.
 *
 * A picture is re-encoded on the device that picked it (frontend/src/lib/avatar.js): at most
 * 192 px on the long edge, WebP when the browser can write it and JPEG otherwise, with the
 * camera's EXIF/GPS data gone by construction. The app then sends the data URL as JSON, so the
 * paired phone needs no separate image request and there is no extra file to sweep. The cap
 * below is deliberately small — an avatar is shown at 34 to 56 CSS px, never full size.
 *
 * This module validates what the client sent. It never decodes the image; the same magic-number
 * check as api/media.js is enough to keep a mislabelled SVG/HTML/video out, and the browser only
 * ever sees an image type it can render through an <img>.
 */
import { sniffMedia } from './media.js';

export const AVATAR_MAX_BYTES = 128 * 1024;
// 128 KiB of bytes become ~175 KiB of base64; the extra room covers the data: prefix and padding.
export const AVATAR_MAX_DATA_URL = 180 * 1024;

const DATA_URL = /^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/]+={0,2})$/;

/**
 * null when `value` is an acceptable profile picture, otherwise the code the route answers with:
 * `avatar-too-large` or `avatar-invalid`. Only JPEG, PNG and WebP are accepted.
 */
export function avatarProblem(value) {
  if (typeof value !== 'string' || !value) return 'avatar-invalid';
  // Refuse an oversized string before decoding it; readBody already capped the request at
  // MAX_BODY (5 MiB), but there is no reason to allocate that much for a 192 px picture.
  if (value.length > AVATAR_MAX_DATA_URL) return 'avatar-too-large';
  const match = DATA_URL.exec(value);
  if (!match) return 'avatar-invalid';
  let bytes;
  try { bytes = Buffer.from(match[2], 'base64'); }
  catch { return 'avatar-invalid'; }
  if (!bytes.length) return 'avatar-invalid';
  if (bytes.length > AVATAR_MAX_BYTES) return 'avatar-too-large';
  const smelled = sniffMedia(bytes.subarray(0, 64));
  if (!smelled || smelled.mime !== match[1]) return 'avatar-invalid';
  return null;
}
