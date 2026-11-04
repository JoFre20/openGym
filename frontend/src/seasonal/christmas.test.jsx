// @vitest-environment happy-dom
// Christmas's moving parts (seasonal/christmas.jsx): the snowfall at a start, the reduced-motion
// path, the workout screen, and the gift's one surprise a day.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const ui = vi.hoisted(() => ({ toast: null }))
vi.mock('../store/useUI.js', () => ({ useUI: { getState: () => ({ toast: ui.toast }) } }))
const buzz = vi.hoisted(() => ({ vibrate: null }))
vi.mock('../lib/sound.js', () => ({ vibrate: p => buzz.vibrate(p) }))

let host, root, reduce = false
// Each test gets the module afresh: the snowfall's "this session" lives in it.
const load = async () => { vi.resetModules(); return import('./christmas.jsx') }
beforeEach(() => {
  localStorage.clear()
  reduce = false
  window.matchMedia = q => ({ matches: reduce && /reduce/.test(q), addEventListener() {}, removeEventListener() {} })
  ui.toast = vi.fn(); buzz.vibrate = vi.fn()
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })
const render = el => act(() => root.render(el))

describe('the snowfall', () => {
  it('falls at every start, with Santa and the glowing Rudolph nose', async () => {
    const { Layer } = await load()
    render(<Layer hidden={false} fresh />)
    expect(host.querySelector('.xm-snow')).not.toBeNull()
    expect(host.querySelectorAll('.xm-snow .xm-flake').length).toBeGreaterThan(10)
    expect(host.querySelector('.xm-snow').getAttribute('aria-hidden')).toBe('true')
    expect(host.querySelector('.xm-santa-flight .xm-sleighsvg')).not.toBeNull()
    expect(host.querySelector('.xm-santa-flight .xm-rudolph-nose')).not.toBeNull()
    render(<Layer hidden fresh />)
    expect(host.querySelector('.xm-snow')).toBeNull()
    expect(host.querySelector('.xm-santa-flight')).toBeNull()
  })

  it('does not fly over a start straight into a workout', async () => {
    const { Layer } = await load()
    render(<Layer hidden fresh={false} />)
    expect(host.innerHTML).toBe('')
    render(<Layer hidden={false} fresh={false} />)
    expect(host.querySelector('.xm-snow')).toBeNull()
    expect(host.querySelector('.xm-santa-flight')).toBeNull()
  })

  it('with Seasonal effects off, only the main event remains', async () => {
    const { Layer } = await load()
    render(<Layer hidden={false} fresh effects={false} />)
    expect(host.querySelector('.xm-snow')).toBeNull()
    expect(host.querySelector('.xm-santa-flight .xm-sleighsvg')).not.toBeNull()
  })

  it('with reduced motion shows a still Santa and no snowfall', async () => {
    reduce = true
    const { Layer } = await load()
    render(<Layer hidden={false} fresh />)
    expect(host.querySelector('.xm-snow')).toBeNull()
    expect(host.querySelector('.xm-santa-still .xm-sleighsvg')).not.toBeNull()
    expect(host.querySelector('.xm-santa-flight')).toBeNull()
  })
})

describe('the gift', () => {
  it('peeks out of its card; one tap a day says something, buzzes, and leaves the card alone', async () => {
    const { Deco } = await load()
    const card = vi.fn()
    render(<div onClick={card}><Deco spot="home-streak" /></div>)
    const btn = () => host.querySelector('.xm-gift')
    expect(btn().getAttribute('aria-hidden')).toBe('true')
    act(() => btn().click())
    expect(card).not.toHaveBeenCalled()
    expect(ui.toast).toHaveBeenCalledTimes(1)
    expect(ui.toast.mock.calls[0][0]).toMatch(/^A gift!/)
    expect(buzz.vibrate).toHaveBeenCalledTimes(1)
    expect(host.querySelector('.xm-burst')).not.toBeNull()
    act(() => btn().click())
    expect(ui.toast.mock.calls[1][0]).toBe('The gift is resting until tomorrow. Even wrapping paper needs a break.')
    expect(buzz.vibrate).toHaveBeenCalledTimes(1)
  })

  it('with reduced motion the surprise is the toast alone, no flakes flying out', async () => {
    reduce = true
    const { Deco } = await load()
    render(<Deco spot="home-streak" />)
    act(() => host.querySelector('.xm-gift').click())
    expect(ui.toast).toHaveBeenCalledTimes(1)
    expect(host.querySelector('.xm-burst')).toBeNull()
  })
})

describe('the Friends page element', () => {
  it('is a small Santa head, hidden from assistive tech', async () => {
    const { Deco } = await load()
    render(<Deco spot="friends" />)
    expect(host.querySelector('.xm-friends .xm-santahead')).not.toBeNull()
    expect(host.querySelector('.xm-friends').getAttribute('aria-hidden')).toBe('true')
  })
})

describe('the spots', () => {
  it('Stats: snow, a star, hanging baubles, lights, a snowflake and peeking gifts, none of them in the way', async () => {
    const { Deco } = await load()
    render(<>{['stats-hdr', 'stats-tile', 'stats-heatmap', 'stats-web', 'stats-peek'].map(s => <Deco key={s} spot={s} />)}</>)
    expect(host.querySelector('.xm-starsvg')).not.toBeNull()
    expect(host.querySelectorAll('.xm-tilebaubles .xm-hang')).toHaveLength(2)
    expect(host.querySelector('.xm-lights .xm-bulb')).not.toBeNull()
    expect(host.querySelector('.xm-flake-bl')).not.toBeNull()
    expect(host.querySelectorAll('.xm-peek-two .xm-giftsvg')).toHaveLength(2)
    for (const el of host.children) expect(el.getAttribute('aria-hidden'), el.className).toBe('true')
    expect(host.querySelectorAll('button')).toHaveLength(0)
  })

  it('the workout screen gets nothing that can be tapped or focused', async () => {
    const { Deco } = await load()
    render(<>{['workout-hdr', 'rest-timer', 'finish'].map(s => <Deco key={s} spot={s} />)}</>)
    expect(host.querySelector('.xm-wcorner .xm-flakesvg')).not.toBeNull()
    expect(host.querySelector('.xm-wcorner .xm-hang')).not.toBeNull()
    expect(host.querySelectorAll('.xm-restsnow .xm-flakesvg')).toHaveLength(3)
    expect(host.querySelectorAll('.xm-finish .xm-treesvg')).toHaveLength(2)
    for (const el of host.children) expect(el.getAttribute('aria-hidden'), el.className).toBe('true')
    expect(host.querySelectorAll('button, a, input, [tabindex]')).toHaveLength(0)
  })

  it('with reduced motion the rest bar has no snow at all', async () => {
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
