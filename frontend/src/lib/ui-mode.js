// Which navigation the app shows (Settings → Look & Home → App layout).
//
// Classic is the layout every profile had before the Activity feed: Home, Plan, Start, Stats,
// Exercises. New puts the Activity feed beside Start and moves Plan and Stats around it; the
// exercise library stays a screen, without a tab of its own. The choice is a synced setting, so
// a phone and a laptop can show the same navigation, and an older app simply ignores it.
export const UI_CLASSIC = 'classic'
export const UI_NEW = 'new'

/** `S.uiMode`, defaulting to Classic for every profile written before the setting existed. */
export const uiModeOf = S => (S?.uiMode === UI_NEW ? UI_NEW : UI_CLASSIC)
export const isNewUI = S => uiModeOf(S) === UI_NEW

/** The root screens, in the order the tab bar shows them. */
export const CLASSIC_TABS = ['home', 'plan', 'start', 'stats', 'library']
export const NEW_TABS = ['home', 'social', 'start', 'plan', 'stats']
export const tabsFor = S => (isNewUI(S) ? NEW_TABS : CLASSIC_TABS)

/**
 * The tab a screen without a tab of its own lights. `cur` is the first path segment the router
 * shows, `state` the location state (Muscles records where it was opened from). Returns null for
 * a root tab and for the workout screen, which the bar handles itself.
 */
export function parentTab(cur, state = null, S = null) {
  const fresh = isNewUI(S)
  if (cur === 'social') return fresh ? 'social' : 'home'
  if (cur === 'crew') return fresh ? 'social' : 'home'
  if (cur === 'settings' || cur === 'checkin') return 'home'
  if (cur === 'history' || cur === 'structural-balance' || cur === 'progress-photos' || cur === 'measurements') return 'stats'
  if (cur === 'muscles') return state?.from === '/stats' ? 'stats' : (fresh ? 'home' : 'library')
  if (cur === 'library') return fresh ? 'home' : 'library'
  return null
}
