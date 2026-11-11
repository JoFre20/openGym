// Where a movement calibration lives. Templates are device-local on purpose: the same exercise
// moves a phone in a pocket and a watch on a wrist in different directions, and even two phones can
// be carried differently. They never enter the synced profile or a backup.
import { REP_SOURCE_PHONE, REP_SOURCE_WATCH, validTemplate } from './rep-core.js'

export const REP_TEMPLATE_PREFIX = 'opengym_rep_template_v1_'
export const REP_TEMPLATE_KINDS = [REP_SOURCE_PHONE, REP_SOURCE_WATCH]

const storageOf = storage => storage || (typeof globalThis !== 'undefined' ? globalThis.localStorage : null)
const sourceOf = source => (source === REP_SOURCE_WATCH ? REP_SOURCE_WATCH : REP_SOURCE_PHONE)

export function repTemplateKey(exerciseId, source = REP_SOURCE_PHONE) {
  return REP_TEMPLATE_PREFIX + sourceOf(source) + '_' + String(exerciseId)
}

export function readRepTemplate(exerciseId, source = REP_SOURCE_PHONE, storage) {
  const s = storageOf(storage)
  if (!s || exerciseId == null) return null
  try {
    const raw = s.getItem(repTemplateKey(exerciseId, source))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return validTemplate(parsed) && parsed.exerciseId === String(exerciseId) && parsed.source === sourceOf(source) ? parsed : null
  } catch {
    return null
  }
}

export function writeRepTemplate(template, storage) {
  const s = storageOf(storage)
  if (!s || !validTemplate(template)) return false
  try {
    s.setItem(repTemplateKey(template.exerciseId, template.source), JSON.stringify(template))
    return true
  } catch {
    return false
  }
}

export function deleteRepTemplate(exerciseId, source = REP_SOURCE_PHONE, storage) {
  const s = storageOf(storage)
  if (!s || exerciseId == null) return false
  try {
    s.removeItem(repTemplateKey(exerciseId, source))
    return true
  } catch {
    return false
  }
}

/** The exercises this device has a calibration for, e.g. for a settings screen. */
export function listRepTemplates(storage, source = null) {
  const s = storageOf(storage)
  if (!s) return []
  const out = []
  try {
    for (let i = 0; i < s.length; i++) {
      const key = s.key(i)
      if (!key || !key.startsWith(REP_TEMPLATE_PREFIX)) continue
      try {
        const parsed = JSON.parse(s.getItem(key))
        if (!validTemplate(parsed)) continue
        if (source && parsed.source !== sourceOf(source)) continue
        out.push(parsed)
      } catch { /* one broken record does not hide the others */ }
    }
  } catch { return out }
  return out.sort((a, b) => String(a.exerciseId).localeCompare(String(b.exerciseId)))
}
