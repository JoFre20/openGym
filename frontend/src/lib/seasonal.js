// Seasonal themes (v1.4.3): a little decoration for a few weeks a year, Halloween first.
// Christmas joined in v1.4.4 and wraps the new year, from 1 December to 6 January. New Year's Eve
// and Chinese New Year followed. Easter and Chinese New Year are moveable, so their windows are
// computed from lib/easter.js and lib/chinese-new-year.js.
//
// This file is all the main bundle carries of them: the list, the date windows and the choice.
// The art, its CSS and its timers live in seasonal/<id>.jsx, fetched only while a theme is on
// (components/Seasonal.jsx), so a profile with themes off, or a day out of season, pays nothing.
//
// The choice is a Look setting like Theme and Accent color, so it syncs with the profile:
// S.seasonal = { halloween: 'auto' | 'on' | 'off', halloweenColors: true, halloweenWorkout: false,
//                christmas: 'auto' | 'on' | 'off', christmasColors: true, christmasWorkout: false,
//                newyear: 'auto' | 'on' | 'off', newyearColors: true, newyearWorkout: false,
//                chinesenewyear: 'auto' | 'on' | 'off', chinesenewyearColors: true, chinesenewyearWorkout: false,
//                easter: 'auto' | 'on' | 'off', easterColors: true, easterWorkout: false }.
// Absent reads as Auto, without the colours, and with the workout screen decorated.
// What happens once a day (the pumpkin's, the gift's, the confetti's, the envelope's or the egg's
// surprise) is per device, in localStorage below.
import { easterWindow } from './easter.js'
import { chineseNewYearWindow } from './chinese-new-year.js'

/* One entry per theme. A fixed theme has `from` and `to`, [month, day], 1-based and inclusive, in
   local time: Halloween is on from 1 October to the end of 31 October and gone on 1 November.
   Christmas runs from 1 December to the end of 6 January, so its window wraps the new year. A
   moveable theme instead has a `window(now)` function returning the same `{ from, to }` pair;
   Easter and Chinese New Year use it. When two themes overlap, the higher `priority` shows (New
   Year's Eve over Christmas on 31 December and 1 January). The strings are English keys,
   translated where they are shown. A theme with `colors` offers an accent override, which is only
   ever opt-in. */
export const THEMES = [
  {
    id: 'halloween', title: 'Halloween', icon: 'pumpkin', tint: 'var(--orange)',
    from: [10, 1], to: [10, 31],
    colors: 'orange', colorsTitle: 'Spooky colors', colorsNote: 'A pumpkin orange accent while Halloween shows. Your own color comes back after.',
    workoutTitle: 'Also during workouts', workoutNote: 'A cobweb in the header, bats behind the rest timer, pumpkins on the finish screen. Never on your sets.',
    during: 'Spiders, bats and one shy pumpkin until the end of October. Never during a workout.',
    back: 'Back next October. The spiders are on holiday.',
  },
  {
    id: 'christmas', title: 'Christmas', icon: 'tree', tint: 'var(--red)',
    from: [12, 1], to: [1, 6],
    colors: 'red', colorsTitle: 'Festive colors', colorsNote: 'A Christmas red accent while Christmas shows. Your own color comes back after.',
    workoutTitle: 'Also during workouts', workoutNote: 'Snow along the header, a tree beside the rest timer, baubles on the finish screen. Never on your sets.',
    during: 'Snow, a tree and a little sparkle from the first of December to the sixth of January. Never on your sets.',
    back: 'Back next December. The snow is in the freezer.',
  },
  {
    id: 'newyear', title: 'New Year’s Eve', icon: 'firework', tint: 'var(--yellow)',
    from: [12, 31], to: [1, 1], priority: 1,
    colors: 'gold', colorsTitle: 'Party colors', colorsNote: 'A gold accent while New Year’s Eve shows. Your own color comes back after.',
    workoutTitle: 'Also during workouts', workoutNote: 'Stars in the header, confetti behind the rest timer, party poppers on the finish screen. Never on your sets.',
    during: 'Fireworks, confetti and a countdown from New Year’s Eve to the first of January. Never on your sets.',
    back: 'Back next New Year’s Eve. The confetti is swept up.',
  },
  {
    id: 'chinesenewyear', title: 'Chinese New Year', icon: 'lantern', tint: 'var(--red)',
    window: now => chineseNewYearWindow(now),
    colors: 'red', colorsTitle: 'Lucky colors', colorsNote: 'A lucky red accent while Chinese New Year shows. Your own color comes back after.',
    workoutTitle: 'Also during workouts', workoutNote: 'Lanterns in the header, a lantern beside the rest timer, red envelopes on the finish screen. Never on your sets.',
    during: 'Lanterns, red envelopes and blossoms from Chinese New Year’s Eve to the Lantern Festival. Never on your sets.',
    back: 'Back next Chinese New Year. The lanterns are still lit.',
  },
  {
    id: 'easter', title: 'Easter', icon: 'egg', tint: 'var(--pink)',
    window: now => easterWindow(now),
    colors: 'pink', colorsTitle: 'Spring colors', colorsNote: 'A soft spring pink accent while Easter shows. Your own color comes back after.',
    workoutTitle: 'Also during workouts', workoutNote: 'Petals in the header, an egg beside the rest timer, eggs on the finish screen. Never on your sets.',
    during: 'Eggs, a bunny and spring flowers from Palm Sunday to the Sunday after Easter. Never on your sets.',
    back: 'Back next Easter. The bunny is hiding the eggs.',
  },
]
export const THEME_IDS = THEMES.map(th => th.id)
export const CHOICES = ['auto', 'on', 'off']
const byId = id => THEMES.find(th => th.id === id) || null

const md = d => (d.getMonth() + 1) * 100 + d.getDate()

/** Whether `now` (local time) falls inside the theme's window. A window may wrap the new year. */
export function inSeason(theme, now = new Date()) {
  const th = typeof theme === 'string' ? byId(theme) : theme
  if (!th) return false
  const w = th.window ? th.window(now) : th
  if (!w || !w.from || !w.to) return false
  const x = md(now), a = w.from[0] * 100 + w.from[1], b = w.to[0] * 100 + w.to[1]
  return a <= b ? x >= a && x <= b : x >= a || x <= b
}

/** 'auto', 'on' or 'off'; anything else (absent, a value from a newer client) reads as Auto. */
export function seasonChoice(S, id) {
  const v = S?.seasonal?.[id]
  return CHOICES.includes(v) ? v : 'auto'
}

/** Whether the theme shows now: On always, Off never, Auto inside its window. */
export function themeOn(S, id, now = new Date()) {
  const c = seasonChoice(S, id)
  return c === 'on' || (c === 'auto' && inSeason(id, now))
}

/** The theme showing now, or null. The highest priority wins; the first in the list breaks a tie. */
export function activeSeason(S, now = new Date()) {
  let best = null, bestPriority = -Infinity
  for (const th of THEMES) {
    if (!themeOn(S, th.id, now)) continue
    const priority = th.priority || 0
    if (priority > bestPriority) { best = th; bestPriority = priority }
  }
  return best?.id || null
}

/** The accent a showing theme puts on instead of the user's own, when its colours are chosen. */
export function seasonAccent(S, now = new Date()) {
  const id = activeSeason(S, now)
  const th = id && byId(id)
  return th?.colors && S?.seasonal?.[id + 'Colors'] === true ? th.colors : null
}

/** Whether the showing theme also decorates the workout screen: on unless switched off. */
export function seasonInWorkout(S, now = new Date()) {
  const id = activeSeason(S, now)
  return !!id && S?.seasonal?.[id + 'Workout'] !== false
}

/* Once a day per device: true the first time it is asked on a local date, false after. Storage
   that is not there (a private window, blocked site data) answers false, so nothing repeats. */
const pad = n => String(n).padStart(2, '0')
const dayOf = now => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
export function onceToday(key, now = new Date()) {
  try {
    const k = 'og_season_' + key, today = dayOf(now)
    if (localStorage.getItem(k) === today) return false
    localStorage.setItem(k, today)
    return true
  } catch (e) { return false }
}
/** Whether onceToday(key) already fired today, without using it up. */
export function doneToday(key, now = new Date()) {
  try { return localStorage.getItem('og_season_' + key) === dayOf(now) } catch (e) { return true }
}

export const reducedMotion = () => {
  try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches } catch (e) { return false }
}
