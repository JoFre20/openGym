// @vitest-environment happy-dom
// Chinese New Year's moving parts (seasonal/chinesenewyear.jsx): the confetti at a start, the
// reduced-motion path, the workout screen, and the red envelope's one surprise a day.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const ui = vi.hoisted(() => ({ toast: null }))
vi.mock('../store/useUI.js', () => ({ useUI: { getState: () => ({ toast: ui.toast }) } }))
const buzz = vi.hoisted(() => ({ vibrate: null }))
vi.mock('../lib/sound.js', () => ({ vibrate: p => buzz.vibrate(p) }))

let host, root, reduce = false
// Each test gets the module afresh: the confetti's "this session" lives in it.
const load = async () => { vi.resetModules(); return import('./chinesenewyear.jsx') }
beforeEach(() => {
  localStorage.clear()
  reduce = false
  window.matchMedia = q => ({ matches: reduce && /reduce/.test(q), addEventListener() {}, removeEventListener() {} })
  ui.toast = vi.fn(); buzz.vibrate = vi.fn()
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })
const render = el => act(() => root.render(el))

describe('the layer', () => {
  it('shows confetti and the dragon at every start, and clears them when hidden', async () => {
    const { Layer } = await load()
    render(<Layer hidden={false} fresh />)
    expect(host.querySelector('.cny-fall')).not.toBeNull()
    expect(host.querySelectorAll('.cny-fall .cny-confetti').length).toBeGreaterThan(15)
    expect(host.querySelector('.cny-fall').getAttribute('aria-hidden')).toBe('true')
    expect(host.querySelector('.cny-dragon-flight .cny-dragonsvg')).not.toBeNull()
    render(<Layer hidden fresh />)
    expect(host.querySelector('.cny-fall')).toBeNull()
    expect(host.querySelector('.cny-dragon-flight')).toBeNull()
  })

  it('does not start over a start straight into a workout', async () => {
    const { Layer } = await load()
    render(<Layer hidden fresh={false} />)
    expect(host.innerHTML).toBe('')
    render(<Layer hidden={false} fresh={false} />)
    expect(host.querySelector('.cny-fall')).toBeNull()
    expect(host.querySelector('.cny-dragon-flight')).toBeNull()
  })

  it('with Seasonal effects off, only the dragon remains', async () => {
    const { Layer } = await load()
    render(<Layer hidden={false} fresh effects={false} />)
    expect(host.querySelector('.cny-fall')).toBeNull()
    expect(host.querySelector('.cny-dragon-flight .cny-dragonsvg')).not.toBeNull()
  })

  it('with reduced motion shows a still dragon and no confetti', async () => {
    reduce = true
    const { Layer } = await load()
    render(<Layer hidden={false} fresh />)
    expect(host.querySelector('.cny-fall')).toBeNull()
    expect(host.querySelector('.cny-dragon-still .cny-dragonsvg')).not.toBeNull()
  })
})

describe('the red envelope', () => {
  it('peeks out of its card; one tap a day says something, buzzes, and leaves the card alone', async () => {
    const { Deco } = await load()
    const card = vi.fn()
    render(<div onClick={card}><Deco spot="home-streak" /></div>)
    const btn = () => host.querySelector('.cny-envelope')
    expect(btn().getAttribute('aria-hidden')).toBe('true')
    act(() => btn().click())
    expect(card).not.toHaveBeenCalled()
    expect(ui.toast).toHaveBeenCalledTimes(1)
    expect(ui.toast.mock.calls[0][0]).toMatch(/^A red envelope!/)
    expect(buzz.vibrate).toHaveBeenCalledTimes(1)
    expect(host.querySelector('.cny-burstbox')).not.toBeNull()
    act(() => btn().click())
    expect(ui.toast.mock.calls[1][0]).toBe('The red envelope is resting until tomorrow. The lanterns are still lit.')
    expect(buzz.vibrate).toHaveBeenCalledTimes(1)
  })

  it('with reduced motion the surprise is the toast alone, no confetti flying out', async () => {
    reduce = true
    const { Deco } = await load()
    render(<Deco spot="home-streak" />)
    act(() => host.querySelector('.cny-envelope').click())
    expect(ui.toast).toHaveBeenCalledTimes(1)
    expect(host.querySelector('.cny-burstbox')).toBeNull()
  })
})

describe('the Friends page element', () => {
  it('is a small lantern, hidden from assistive tech', async () => {
    const { Deco } = await load()
    render(<Deco spot="friends" />)
    expect(host.querySelector('.cny-friends .cny-lanternsvg')).not.toBeNull()
    expect(host.querySelector('.cny-friends').getAttribute('aria-hidden')).toBe('true')
  })
})

describe('the spots', () => {
  it('Stats: blossoms, hanging lanterns, a coin garland, a corner blossom and two envelopes, none of them in the way', async () => {
    const { Deco } = await load()
    render(<>{['stats-hdr', 'stats-tile', 'stats-heatmap', 'stats-web', 'stats-peek'].map(s => <Deco key={s} spot={s} />)}</>)
    expect(host.querySelector('.cny-hdrblossom')).not.toBeNull()
    expect(host.querySelectorAll('.cny-tilelanterns .cny-hang')).toHaveLength(2)
    expect(host.querySelectorAll('.cny-garland .cny-coinsvg')).toHaveLength(5)
    expect(host.querySelector('.cny-blossom-bl')).not.toBeNull()
    expect(host.querySelectorAll('.cny-peek-two .cny-envsvg')).toHaveLength(2)
    for (const el of host.children) expect(el.getAttribute('aria-hidden'), el.className).toBe('true')
    expect(host.querySelectorAll('button')).toHaveLength(0)
  })

  it('the workout screen gets nothing that can be tapped or focused', async () => {
    const { Deco } = await load()
    render(<>{['workout-hdr', 'rest-timer', 'finish'].map(s => <Deco key={s} spot={s} />)}</>)
    expect(host.querySelector('.cny-wcorner .cny-blossomsvg')).not.toBeNull()
    expect(host.querySelector('.cny-wcorner .cny-hang')).not.toBeNull()
    expect(host.querySelectorAll('.cny-restconfetti .cny-rconf')).toHaveLength(4)
    expect(host.querySelectorAll('.cny-finish .cny-lanternsvg')).toHaveLength(2)
    for (const el of host.children) expect(el.getAttribute('aria-hidden'), el.className).toBe('true')
    expect(host.querySelectorAll('button, a, input, [tabindex]')).toHaveLength(0)
  })

  it('with reduced motion the rest bar has no confetti at all', async () => {
    reduce = true
    const { Deco } = await load()
    render(<Deco spot="rest-timer" />)
    expect(host.innerHTML).toBe('')
  })

  it('the decorations are hidden from assistive tech and never in a tap\'s way', async () => {
    const { Deco } = await load()
    render(<><Deco spot="home-hero" /><Deco spot="plan-card" /><Deco spot="header-bats" /><Deco spot="workout" /></>)
    const deco = [...host.children]
    expect(deco).toHaveLength(3)                      // an unknown spot draws nothing
    for (const el of deco) expect(el.getAttribute('aria-hidden')).toBe('true')
    expect(host.querySelectorAll('button')).toHaveLength(0)
  })
})
