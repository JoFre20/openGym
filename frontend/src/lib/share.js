import { copyText } from './clipboard.js'
import { MOBILE } from './mobile.js'

/**
 * Hands plain text to the platform's share sheet where there is one, and copies it otherwise.
 * Answers 'shared' | 'copied' | 'cancelled' | 'failed'. A share sheet the user dismissed copies
 * nothing: a link they declined to send should not quietly replace their clipboard.
 */
export async function shareText(text, { title = '' } = {}) {
  const value = String(text || '')
  if (!value) return 'failed'
  if (MOBILE) {
    try {
      const { Share } = await import('@capacitor/share')
      await Share.share({ title: title || undefined, text: value })
      return 'shared'
    } catch (e) {
      if (/cancel/i.test(String(e?.message || ''))) return 'cancelled'
      // The plugin can be missing in a browser-ish shell; the clipboard below is still a way out.
    }
  } else if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: title || undefined, text: value })
      return 'shared'
    } catch (e) {
      if (e?.name === 'AbortError') return 'cancelled'
    }
  }
  return await copyText(value) ? 'copied' : 'failed'
}
