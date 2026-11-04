// Easter's date logic (lib/easter.js): the Gregorian computus and the window the theme uses.
import { describe, expect, it } from 'vitest'
import { easterSunday, easterWindow } from './easter.js'

const ymd = d => [d.getFullYear(), d.getMonth() + 1, d.getDate()]

describe('Easter Sunday', () => {
  it.each([
    [2024, 3, 31],
    [2025, 4, 20],
    [2026, 4, 5],
    [2027, 3, 28],
    [2028, 4, 16],
    [2038, 4, 25],     // the latest Easter can fall
    [2285, 3, 22],     // the earliest it can fall
  ])('%i falls on %i-%i', (year, month, day) => {
    expect(ymd(easterSunday(year))).toEqual([year, month, day])
  })

  it('is a local date at noon, so the calendar day never flips with the clock', () => {
    expect(easterSunday(2026).getHours()).toBe(12)
  })
})

describe('the Easter theme window', () => {
  it('runs from Palm Sunday through the Sunday after Easter', () => {
    expect(easterWindow(2024)).toEqual({ from: [3, 24], to: [4, 7] })
    expect(easterWindow(2025)).toEqual({ from: [4, 13], to: [4, 27] })
    expect(easterWindow(2026)).toEqual({ from: [3, 29], to: [4, 12] })
    expect(easterWindow(2027)).toEqual({ from: [3, 21], to: [4, 4] })
  })

  it('takes a Date as well as a year', () => {
    expect(easterWindow(new Date(2026, 3, 5, 12))).toEqual({ from: [3, 29], to: [4, 12] })
  })
})
