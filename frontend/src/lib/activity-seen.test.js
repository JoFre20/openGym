// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { markActivitySeen, readActivitySeen } from './activity-seen.js'

beforeEach(() => localStorage.clear())

describe('what Activity has already shown', () => {
  it('starts with no mark for a profile', () => {
    expect(readActivitySeen('u1')).toBeNull()
    expect(readActivitySeen('u2')).toBeNull()
  })

  it('keeps one mark per profile and per device', () => {
    markActivitySeen('u1', 1000)
    markActivitySeen('u2', 2000)
    expect(readActivitySeen('u1')).toBe(1000)
    expect(readActivitySeen('u2')).toBe(2000)
    expect(readActivitySeen('guest')).toBeNull()
  })

  it('ignores damaged storage and never throws', () => {
    localStorage.setItem('gym_activity_seen_v1:u1', '{"at":"nope"}')
    expect(readActivitySeen('u1')).toBeNull()
    localStorage.setItem('gym_activity_seen_v1:u1', 'not json')
    expect(readActivitySeen('u1')).toBeNull()
  })
})
