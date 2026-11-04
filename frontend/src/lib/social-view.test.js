import { describe, expect, it } from 'vitest'
import {
  formatFriendCodeInput, friendCodeComplete, friendLinkUrl, initialsOf, ringProgress, socialWeightView
} from './social-view.js'
import { convertBodyWeight } from './units.js'

describe('social view helpers', () => {
  it('formats a friend code as it is typed', () => {
    expect(formatFriendCodeInput('a7x92b')).toBe('A7X-92B')
    expect(formatFriendCodeInput('a7x-92b')).toBe('A7X-92B')
    expect(formatFriendCodeInput(' a7x 92b ')).toBe('A7X-92B')
    expect(formatFriendCodeInput('a7x92bmore')).toBe('A7X-92B')
    expect(formatFriendCodeInput('a7')).toBe('A7')
  })

  it('accepts only the six characters the server hands out', () => {
    expect(friendCodeComplete('a7x-92b')).toBe(true)
    expect(friendCodeComplete('A7X-92B')).toBe(true)
    expect(friendCodeComplete('A7X-92')).toBe(false)
    expect(friendCodeComplete('A7X-92O')).toBe(false)
    expect(friendCodeComplete('A7X-921')).toBe(false)
  })

  it('builds a share link on the server the app is paired with', () => {
    expect(friendLinkUrl('a7x92b', 'https://gym.example')).toBe('https://gym.example/#/social?friend=A7X-92B')
    expect(friendLinkUrl('A7X-92B', 'https://gym.example/gym')).toBe('https://gym.example/gym/#/social?friend=A7X-92B')
    expect(friendLinkUrl('A7X-92B', 'https://gym.example/gym/')).toBe('https://gym.example/gym/#/social?friend=A7X-92B')
    expect(friendLinkUrl('', 'https://gym.example')).toBe('')
    expect(friendLinkUrl('A7X-92B', '')).toBe('')
  })

  it('makes two initials, and never an empty avatar', () => {
    expect(initialsOf('Ada Lovelace')).toBe('AL')
    expect(initialsOf('Ada')).toBe('A')
    expect(initialsOf('  ')).toBe('?')
  })

  it('keeps the ring between zero and a full week', () => {
    expect(ringProgress(null)).toBe(0)
    expect(ringProgress(0)).toBe(0)
    expect(ringProgress(3)).toBeCloseTo(3 / 7)
    expect(ringProgress(9)).toBe(1)
  })

  it('converts the shared weight into the viewer unit', () => {
    const weight = { mode: 'absolute', unit: 'kg', current: 80, delta: -1.5, since: '2026-10-01', trend: 'down' }
    expect(socialWeightView(weight, 'lb')).toEqual({
      mode: 'absolute',
      unit: 'lb',
      current: convertBodyWeight(80, 'kg', 'lb'),
      delta: convertBodyWeight(-1.5, 'kg', 'lb'),
      since: '2026-10-01',
      trend: 'down',
    })
    expect(socialWeightView(weight, 'kg').current).toBe(80)
    expect(socialWeightView({ mode: 'delta', unit: 'kg', delta: -1 }, 'lb')).toMatchObject({ mode: 'delta', current: null, unit: 'lb' })
    expect(socialWeightView(null, 'kg')).toBeNull()
  })
})
