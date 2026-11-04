// Chinese New Year is a moveable feast on the lunisolar calendar. The exact date comes from the
// new moon in China, so a tested lookup table is safer than an astronomical approximation. The
// table covers 2024-2050; outside it the theme falls back to a fixed early-February window, which
// keeps the decoration working without pretending to know the exact date.

const DATES = {
  2024: [2, 10],
  2025: [1, 29],
  2026: [2, 17],
  2027: [2, 6],
  2028: [1, 26],
  2029: [2, 13],
  2030: [2, 3],
  2031: [1, 23],
  2032: [2, 11],
  2033: [1, 31],
  2034: [2, 19],
  2035: [2, 8],
  2036: [1, 28],
  2037: [2, 15],
  2038: [2, 4],
  2039: [1, 24],
  2040: [2, 12],
  2041: [2, 1],
  2042: [1, 22],
  2043: [2, 10],
  2044: [1, 30],
  2045: [2, 17],
  2046: [2, 6],
  2047: [1, 26],
  2048: [2, 14],
  2049: [2, 2],
  2050: [1, 23],
}

const FALLBACK = { from: [2, 1], to: [2, 15] }
const md = d => [d.getMonth() + 1, d.getDate()]
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }

/** Chinese New Year as [month, day], or null for a year outside the table. */
export function chineseNewYear(year) {
  const d = DATES[year]
  return d ? [...d] : null
}

/** Chinese New Year's Eve through the Lantern Festival (one day before, fourteen days after). */
export function chineseNewYearWindow(when = new Date()) {
  const year = when instanceof Date ? when.getFullYear() : when
  const d = DATES[year]
  if (!d) return { ...FALLBACK, from: [...FALLBACK.from], to: [...FALLBACK.to] }
  const date = new Date(year, d[0] - 1, d[1], 12)
  return { from: md(addDays(date, -1)), to: md(addDays(date, 14)) }
}
