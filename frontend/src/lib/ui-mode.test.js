import { describe, expect, it } from 'vitest'
import { CLASSIC_TABS, NEW_TABS, isNewUI, parentTab, tabsFor, uiModeOf, UI_CLASSIC, UI_NEW } from './ui-mode.js'

describe('the app layout setting', () => {
  it('defaults to Classic and only accepts New explicitly', () => {
    expect(uiModeOf({})).toBe(UI_CLASSIC)
    expect(uiModeOf({ uiMode: 'nope' })).toBe(UI_CLASSIC)
    expect(uiModeOf({ uiMode: UI_NEW })).toBe(UI_NEW)
    expect(isNewUI({ uiMode: UI_NEW })).toBe(true)
    expect(isNewUI({})).toBe(false)
  })

  it('keeps the old five tabs and puts Activity between Home and Start', () => {
    expect(tabsFor({})).toEqual(CLASSIC_TABS)
    expect(tabsFor({ uiMode: UI_NEW })).toEqual(NEW_TABS)
    expect(NEW_TABS).toEqual(['home', 'social', 'start', 'plan', 'stats'])
  })
})

describe('the tab a nested screen lights', () => {
  it('keeps Today, Settings and Check-in on Home in both layouts', () => {
    for (const S of [{}, { uiMode: UI_NEW }]) {
      expect(parentTab('settings', null, S)).toBe('home')
      expect(parentTab('checkin', null, S)).toBe('home')
    }
  })

  it('puts the library and Muscles under Home in the new layout', () => {
    expect(parentTab('library', null, { uiMode: UI_NEW })).toBe('home')
    expect(parentTab('muscles', null, { uiMode: UI_NEW })).toBe('home')
    expect(parentTab('muscles', { from: '/stats' }, { uiMode: UI_NEW })).toBe('stats')
    expect(parentTab('library', null, {})).toBe('library')
    expect(parentTab('muscles', null, {})).toBe('library')
  })

  it('lights Activity for the feed and its Crew page in the new layout', () => {
    expect(parentTab('social', null, { uiMode: UI_NEW })).toBe('social')
    expect(parentTab('crew', null, { uiMode: UI_NEW })).toBe('social')
    expect(parentTab('social', null, {})).toBe('home')
  })

  it('leaves root tabs and the workout screen to the bar', () => {
    for (const cur of ['home', 'plan', 'stats', 'workout']) {
      expect(parentTab(cur, null, {})).toBeNull()
      expect(parentTab(cur, null, { uiMode: UI_NEW })).toBeNull()
    }
  })
})
