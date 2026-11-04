// @vitest-environment happy-dom
// Easter's moving parts (seasonal/easter.jsx): the petal fall at a start, the reduced-motion
// path, the workout screen, and the egg's one surprise a day.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const ui = vi.hoisted(() => ({ toast: null }))
vi.mock('../store/useUI.js', () => ({ useUI: { getState: () => ({ toast: ui.toast }) } }))
const buzz = vi.hoisted(() => ({ vibrate: null }))
vi.mock('../lib/sound.js', () => ({ vibrate: p => buzz.vibrate(p) }))

let host, root, reduce = false
// Each test gets the module afresh: the petal fall's "this session" lives in it.
const load = async () => { vi.resetModules(); return import('./easter.jsx') }
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
  it('shows petals and the meadow at every start, and clears them when hidden', async () => {
    const { Layer } = await load()
    render(<Layer hidden={false} fresh />)
    expect(host.querySelector('.ea-fall')).not.toBeNull()
    expect(host.querySelectorAll('.ea-fall .ea-fpetal').length).toBeGreaterThan(10)
    expect(host.querySelector('.ea-fall').getAttribute('aria-hidden')).toBe('true')
    expect(host.querySelector('.ea-meadow')).not.toBeNull()
    expect(host.querySelectorAll('.ea-meadow .ea-runner')).toHaveLength(2)
    render(<Layer hidden fresh />)
    expect(host.querySelector('.ea-fall')).toBeNull()
    expect(host.querySelector('.ea-meadow')).toBeNull()
  })

  it('does not start over a start straight into a workout', async () => {
    const { Layer } = await load()
    render(<Layer hidden fresh={false} />)
    expect(host.innerHTML).toBe('')
    render(<Layer hidden={false} fresh={false} />)
    expect(host.querySelector('.ea-fall')).toBeNull()
    expect(host.querySelector('.ea-meadow')).toBeNull()
  })

  it('with Seasonal effects off, only the meadow remains', async () => {
    const { Layer } = await load()
    render(<Layer hidden={false} fresh effects={false} />)
    expect(host.querySelector('.ea-fall')).toBeNull()
    expect(host.querySelector('.ea-meadow')).not.toBeNull()
    expect(host.querySelectorAll('.ea-meadow .ea-runner')).toHaveLength(2)
  })

  it('with reduced motion shows the still meadow and no petal fall', async () => {
    reduce = true
    const { Layer } = await load()
    render(<Layer hidden={false} fresh />)
    expect(host.querySelector('.ea-fall')).toBeNull()
    expect(host.querySelector('.ea-meadow-still')).not.toBeNull()
  })
})

describe('the egg', () => {
  it('peeks out of its card; one tap a day says something, buzzes, and leaves the card alone', async () => {
    const { Deco } = await load()
    const card = vi.fn()
    render(<div onClick={card}><Deco spot="home-streak" /></div>)
    const btn = () => host.querySelector('.ea-egg')
    expect(btn().getAttribute('aria-hidden')).toBe('true')
    act(() => btn().click())
    expect(card).not.toHaveBeenCalled()
    expect(ui.toast).toHaveBeenCalledTimes(1)
    expect(ui.toast.mock.calls[0][0]).toMatch(/^An egg!/)
    expect(buzz.vibrate).toHaveBeenCalledTimes(1)
    expect(host.querySelector('.ea-burst')).not.toBeNull()
    act(() => btn().click())
    expect(ui.toast.mock.calls[1][0]).toBe('The egg is napping until tomorrow. The bunny is hiding the rest.')
    expect(buzz.vibrate).toHaveBeenCalledTimes(1)
  })

  it('with reduced motion the surprise is the toast alone, no petals flying out', async () => {
    reduce = true
    const { Deco } = await load()
    render(<Deco spot="home-streak" />)
    act(() => host.querySelector('.ea-egg').click())
    expect(ui.toast).toHaveBeenCalledTimes(1)
    expect(host.querySelector('.ea-burst')).toBeNull()
  })
})

describe('the Friends page element', () => {
  it('is a small bunny, hidden from assistive tech', async () => {
    const { Deco } = await load()
    render(<Deco spot="friends" />)
    expect(host.querySelector('.ea-friends .ea-bunnysvg')).not.toBeNull()
    expect(host.querySelector('.ea-friends').getAttribute('aria-hidden')).toBe('true')
  })
})

describe('the spots', () => {
  it('Stats: petals, a flower, hanging eggs, a garland, a corner flower and peeking eggs, none of them in the way', async () => {
    const { Deco } = await load()
    render(<>{['stats-hdr', 'stats-tile', 'stats-heatmap', 'stats-web', 'stats-peek'].map(s => <Deco key={s} spot={s} />)}</>)
    expect(host.querySelector('.ea-hdrflower')).not.toBeNull()
    expect(host.querySelectorAll('.ea-tileeggs .ea-hang')).toHaveLength(2)
    expect(host.querySelectorAll('.ea-garland .ea-flowersvg')).toHaveLength(5)
    expect(host.querySelector('.ea-flower-bl')).not.toBeNull()
    expect(host.querySelectorAll('.ea-peek-two .ea-eggsvg')).toHaveLength(2)
    for (const el of host.children) expect(el.getAttribute('aria-hidden'), el.className).toBe('true')
    expect(host.querySelectorAll('button')).toHaveLength(0)
  })

  it('the workout screen gets nothing that can be tapped or focused', async () => {
    const { Deco } = await load()
    render(<>{['workout-hdr', 'rest-timer', 'finish'].map(s => <Deco key={s} spot={s} />)}</>)
    expect(host.querySelector('.ea-wcorner .ea-flowersvg')).not.toBeNull()
    expect(host.querySelector('.ea-wcorner .ea-hang')).not.toBeNull()
    expect(host.querySelectorAll('.ea-restpetals .ea-petalsvg')).toHaveLength(3)
    expect(host.querySelectorAll('.ea-finish .ea-eggsvg')).toHaveLength(2)
    for (const el of host.children) expect(el.getAttribute('aria-hidden'), el.className).toBe('true')
    expect(host.querySelectorAll('button, a, input, [tabindex]')).toHaveLength(0)
  })

  it('with reduced motion the rest bar has no petals at all', async () => {
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
