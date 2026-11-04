// Chinese New Year's date logic (lib/chinese-new-year.js): the lookup table and the theme window.
import { describe, expect, it } from 'vitest'
import { chineseNewYear, chineseNewYearWindow } from './chinese-new-year.js'

describe('Chinese New Year', () => {
  it.each([
    [2024, 2, 10],
    [2025, 1, 29],
    [2026, 2, 17],
    [2027, 2, 6],
    [2028, 1, 26],
    [2030, 2, 3],
    [2033, 1, 31],
    [2038, 2, 4],
    [2050, 1, 23],
  ])('%i falls on %i-%i', (year, month, day) => {
    expect(chineseNewYear(year)).toEqual([month, day])
  })

  it('answers null for a year outside the table', () => {
    expect(chineseNewYear(2061)).toBe(null)
  })
})

describe('the Chinese New Year theme window', () => {
  it('runs from New Year\'s Eve through the Lantern Festival', () => {
    expect(chineseNewYearWindow(2024)).toEqual({ from: [2, 9], to: [2, 24] })
    expect(chineseNewYearWindow(2025)).toEqual({ from: [1, 28], to: [2, 12] })
    expect(chineseNewYearWindow(2026)).toEqual({ from: [2, 16], to: [3, 3] })
    expect(chineseNewYearWindow(2030)).toEqual({ from: [2, 2], to: [2, 17] })
    expect(chineseNewYearWindow(2050)).toEqual({ from: [1, 22], to: [2, 6] })
  })

  it('takes a Date as well as a year', () => {
    expect(chineseNewYearWindow(new Date(2026, 1, 17, 12))).toEqual({ from: [2, 16], to: [3, 3] })
  })

  it('falls back to early February outside the table', () => {
    expect(chineseNewYearWindow(2061)).toEqual({ from: [2, 1], to: [2, 15] })
  })
})
