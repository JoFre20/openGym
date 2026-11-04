// Easter is a moveable feast, so unlike Halloween and Christmas it cannot be described by a
// fixed month/day pair. The Gregorian computus below is the Anonymous algorithm, pure and
// tested against known dates. Keep it local time: the theme windows are [month, day] pair
// comparisons on the device's calendar, never UTC.

const md = d => [d.getMonth() + 1, d.getDate()]
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }

/** Easter Sunday in the Gregorian calendar for `year`, at local noon. */
export function easterSunday(year) {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(year, month - 1, day, 12)
}

/** The Easter theme's window: Palm Sunday to the Sunday after Easter, seven days either side. */
export function easterWindow(when = new Date()) {
  const year = when instanceof Date ? when.getFullYear() : when
  const easter = easterSunday(year)
  return { from: md(addDays(easter, -7)), to: md(addDays(easter, 7)) }
}
