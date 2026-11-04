import { convertBodyWeight } from './units.js'

// The same alphabet the server hands out (api/social.js): look-alikes such as O/0 and I/1 are
// left out, so a code read off a screen cannot be mistyped into a different valid one.
export const FRIEND_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function formatFriendCodeInput(raw) {
  const code = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
  return code.length > 3 ? code.slice(0, 3) + '-' + code.slice(3) : code
}

export function friendCodeComplete(raw) {
  const code = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return code.length === 6 && [...code].every(ch => FRIEND_CODE_ALPHABET.includes(ch))
}

// A link to this app that opens the friends screen with the code filled in. Built from the
// server the app is paired with, not the page's own origin: the phone app serves its assets from
// capacitor://localhost and would otherwise share a link nobody else can open. The trailing slash
// before the hash matters for subpath deployments — nginx redirects /gym to /gym/ and drops a
// hash that was already in the URL.
export function friendLinkUrl(code, server) {
  const formatted = formatFriendCodeInput(code)
  const base = String(server || '').trim()
  if (!formatted || !base) return ''
  try {
    const url = new URL(base)
    url.search = ''
    url.hash = ''
    url.pathname = url.pathname.replace(/\/?$/, '/')
    url.hash = '/social?friend=' + encodeURIComponent(formatted)
    return url.toString()
  } catch {
    return ''
  }
}

export function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2)
  const initials = parts.map(part => Array.from(part)[0] || '').join('')
  return (initials || '?').toUpperCase()
}

export function ringProgress(count, days = 7) {
  if (count == null) return 0
  return Math.max(0, Math.min(days, Number(count) || 0)) / days
}

export function socialWeightView(weight, viewerUnit) {
  if (!weight) return null
  const from = weight.unit === 'lb' ? 'lb' : 'kg'
  const to = viewerUnit === 'lb' ? 'lb' : 'kg'
  return {
    mode: weight.mode,
    unit: to,
    current: weight.current != null ? convertBodyWeight(weight.current, from, to) : null,
    delta: weight.delta != null ? convertBodyWeight(weight.delta, from, to) : null,
    since: weight.since || null,
    trend: weight.trend || null,
  }
}
