import { describe, it, expect, beforeEach } from 'vitest'
import {
  REP_TEMPLATE_PREFIX, deleteRepTemplate, listRepTemplates, readRepTemplate, repTemplateKey, writeRepTemplate,
} from './rep-templates.js'

const template = (exerciseId = '0025', source = 'iphone') => ({
  v: 1, exerciseId, source, createdAt: 1, reps: 3, detectedReps: 3, sampleCount: 300,
  durationMs: 1600, axis: [0, 0, 1], pMax: 4, pMin: -3.8, phaseOrder: 'positive_first',
  noiseFloor: 0.1, neutralThreshold: 0.4, minRepMs: 720, maxRepMs: 5000, alpha: 0.2,
  normalizedCurve: new Array(50).fill(0), peakToPeak: 7.8,
})

class MemoryStorage {
  constructor() { this.map = new Map() }
  get length() { return this.map.size }
  key(i) { return [...this.map.keys()][i] ?? null }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null }
  setItem(k, v) { this.map.set(k, String(v)) }
  removeItem(k) { this.map.delete(k) }
  clear() { this.map.clear() }
}

let storage
beforeEach(() => { storage = new MemoryStorage() })

describe('rep templates', () => {
  it('keeps phone and watch calibrations separate', () => {
    expect(writeRepTemplate(template('0025', 'iphone'), storage)).toBe(true)
    expect(writeRepTemplate(template('0025', 'watch'), storage)).toBe(true)
    expect(readRepTemplate('0025', 'iphone', storage)?.source).toBe('iphone')
    expect(readRepTemplate('0025', 'watch', storage)?.source).toBe('watch')
    expect(repTemplateKey('0025', 'watch')).toBe(REP_TEMPLATE_PREFIX + 'watch_0025')
  })

  it('round-trips and deletes one source only', () => {
    writeRepTemplate(template('0025', 'iphone'), storage)
    writeRepTemplate(template('0025', 'watch'), storage)
    expect(deleteRepTemplate('0025', 'iphone', storage)).toBe(true)
    expect(readRepTemplate('0025', 'iphone', storage)).toBeNull()
    expect(readRepTemplate('0025', 'watch', storage)).not.toBeNull()
  })

  it('rejects an invalid or foreign record', () => {
    storage.setItem(repTemplateKey('0025', 'iphone'), '{"v":1,"exerciseId":"0025","source":"iphone"}')
    expect(readRepTemplate('0025', 'iphone', storage)).toBeNull()
    writeRepTemplate(template('0043', 'iphone'), storage)
    expect(readRepTemplate('0025', 'iphone', storage)).toBeNull()
  })

  it('lists what this device has', () => {
    writeRepTemplate(template('0043', 'watch'), storage)
    writeRepTemplate(template('0025', 'iphone'), storage)
    writeRepTemplate(template('0025', 'watch'), storage)
    expect(listRepTemplates(storage).map(t => `${t.exerciseId}/${t.source}`)).toEqual(['0025/iphone', '0025/watch', '0043/watch'])
    expect(listRepTemplates(storage, 'watch').map(t => t.exerciseId)).toEqual(['0025', '0043'])
  })
})
