import { useEffect, useRef, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { vibrate } from '../lib/sound.js'
import { onceToday, doneToday, reducedMotion } from '../lib/seasonal.js'
import dragonUrl from './chinese-dragon.svg'
import './chinesenewyear.css'

/* Chinese New Year (v1.4.4), fetched only while the theme shows (components/Seasonal.jsx). All of
   it is hand-drawn inline SVG, moved with CSS transforms and opacity only: no rAF loop, nothing
   that lays the page out again, and every animation has an end. Everything is aria-hidden and
   lets taps through, except the red envelope, which is the point. Never on the workout screen:
   App.jsx hides the layer there, and nothing on the workout screen can be tapped. */

/* ---------------------------------------------------------------- art -- */

const Lantern = ({ className = '' }) => (
  <svg className={'cny-lanternsvg ' + className} viewBox="0 0 40 52" aria-hidden="true" focusable="false">
    <path className="cny-string" d="M20 2v5" />
    <rect className="cny-cap" x="14" y="6.6" width="12" height="3.2" rx="1.2" />
    <path className="cny-body" d="M9.4 12.4h21.2v19.2c0 5.4-4.6 9-10.6 9s-10.6-3.6-10.6-9Z" />
    <path className="cny-rib" d="M20 12.4v28.2M13.2 14.2v22.4M26.8 14.2v22.4" />
    <rect className="cny-cap" x="14" y="40.4" width="12" height="3.2" rx="1.2" />
    <path className="cny-tassel" d="M20 43.6v6M16.4 46.2l1.2 5.4M23.6 46.2l-1.2 5.4" />
  </svg>
)

const Envelope = ({ className = '' }) => (
  <svg className={'cny-envsvg ' + className} viewBox="0 0 40 32" aria-hidden="true" focusable="false">
    <rect className="cny-env" x="4" y="5" width="32" height="23" rx="2.4" />
    <path className="cny-env-flap" d="M4.6 6.4 20 18 35.4 6.4" />
    <circle className="cny-seal" cx="20" cy="17.4" r="4.4" />
    <path className="cny-seal-mark" d="M18.4 15.4h3.2v4h-3.2Z" />
  </svg>
)

const Blossom = ({ className = '' }) => (
  <svg className={'cny-blossomsvg ' + className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <g className="cny-petals">
      <ellipse cx="12" cy="6.2" rx="3.2" ry="4.2" />
      <ellipse cx="17.8" cy="12" rx="4.2" ry="3.2" />
      <ellipse cx="12" cy="17.8" rx="3.2" ry="4.2" />
      <ellipse cx="6.2" cy="12" rx="4.2" ry="3.2" />
    </g>
    <circle className="cny-center" cx="12" cy="12" r="2.4" />
  </svg>
)

const Coin = ({ className = '' }) => (
  <svg className={'cny-coinsvg ' + className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <circle className="cny-coin" cx="12" cy="12" r="8.2" />
    <rect className="cny-hole" x="9.4" y="9.4" width="5.2" height="5.2" rx="1" />
  </svg>
)

// Chinese dragon silhouette, Openclipart #319534 (CC0), recoloured for openGym.
const Dragon = ({ className = '' }) => (
  <img className={'cny-dragonsvg ' + className} src={dragonUrl} alt="" aria-hidden="true" />
)

const HangingLantern = ({ len = 28, className = '' }) => (
  <span className={'cny-hang ' + className} style={{ '--len': len + 'px' }} aria-hidden="true">
    <span className="cny-hangthread" /><Lantern />
  </span>
)

/* -------------------------------------------------------- the layer -- */

// Confetti at every start of the app, and again when it comes back to the front after AWAY_MS or
// more in the background. Time away is counted here, at module level, so it is right however long
// the layer itself was mounted.
export const AWAY_MS = 30 * 60 * 1000
let hiddenAt = null
const onReturn = new Set()
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); return }
    const away = hiddenAt !== null && Date.now() - hiddenAt >= AWAY_MS
    hiddenAt = null
    if (away) onReturn.forEach(fn => fn())
  })
}

// Deterministic, so the same start always looks the same.
const CONFETTI = Array.from({ length: 20 }, (_, i) => [
  (i * 41 + 7) % 96,
  ((i * 17) % 50) / 10,
  9 + (i % 5),
  ((i % 7) - 3) * 7,
  4 + (i % 3) * 2,
  7 + (i % 4) * 2,
  i % 3,
])

function DragonFlight({ still }) {
  if (still) return <div className="cny-dragon-still" aria-hidden="true"><Dragon /></div>
  return <div className="cny-dragon-flight" aria-hidden="true"><Dragon /></div>
}

/** Confetti and the dragon at every start, and after a long while away. Nothing while `hidden`. */
export function Layer({ hidden, fresh, effects = true }) {
  const [fall, setFall] = useState(false)
  const [dragon, setDragon] = useState(null)   // null | 'fly' | 'still'
  const hiddenNow = useRef(hidden)
  hiddenNow.current = hidden
  useEffect(() => {
    if (hidden) { setFall(false); setDragon(null); return }
    if (!effects) setFall(false)
    const still = reducedMotion()
    const start = () => {
      setFall(effects && !still)
      setDragon(still ? 'still' : 'fly')
    }
    if (fresh) start()
    const back = () => { if (!hiddenNow.current) start() }
    onReturn.add(back)
    return () => { onReturn.delete(back) }
  }, [hidden, fresh, effects])
  useEffect(() => {
    if (!fall) return
    const tm = setTimeout(() => setFall(false), 14000)
    return () => clearTimeout(tm)
  }, [fall])
  useEffect(() => {
    if (!dragon) return
    const tm = setTimeout(() => setDragon(null), dragon === 'still' ? 4000 : 9000)
    return () => clearTimeout(tm)
  }, [dragon])
  if (hidden) return null
  return <>
    {fall && <div className="cny-fall" aria-hidden="true">
      {CONFETTI.map(([x, delay, dur, drift, w, h, c], i) => (
        <span key={i} className="cny-confetti" style={{ '--x': x + '%', '--delay': delay + 's', '--dur': dur + 's', '--drift': drift + 'px', '--w': w + 'px', '--h': h + 'px', '--c': `var(--cny-c${c + 1})` }} />
      ))}
    </div>}
    {dragon && <DragonFlight still={dragon === 'still'} />}
  </>
}

/* ----------------------------------------------------- the spots -- */

/** Decoration for one place in a view. Unknown spots draw nothing. */
export function Deco({ spot }) {
  switch (spot) {
    case 'friends': return <span className="cny-friends" aria-hidden="true"><Lantern /></span>
    case 'header-bats': return <Blossoms />
    case 'home-hero': return <Lantern className="cny-lantern-br" />
    case 'plan-card': return <Envelope className="cny-env-tr" />
    case 'home-streak': return <PeekEnvelope />
    // Stats: blossoms and a flower in the header, hanging lanterns in the lifetime tile, a coin
    // garland on the activity card, a blossom in the corner and two envelopes peeking above a card.
    case 'stats-hdr': return <><Blossoms /><Blossom className="cny-hdrblossom" /></>
    case 'stats-tile': return <span className="cny-tilelanterns" aria-hidden="true"><HangingLantern len={30} /><HangingLantern len={14} className="cny-hang-b" /></span>
    case 'stats-heatmap': return <CoinGarland />
    case 'stats-web': return <Blossom className="cny-blossom-bl" />
    case 'stats-peek': return <span className="cny-peek cny-peek-two" aria-hidden="true"><span className="cny-env-wrap"><Envelope /></span><span className="cny-env-wrap cny-env-s"><Envelope /></span></span>
    // The workout screen: nothing there can be tapped, and nothing sits on a set, a button,
    // a timer, the chip row or an exercise picture. The blossom and the lantern sit in the page's
    // side gutter, confetti drifts along the rest bar, and two lanterns flank the finish trophy.
    case 'workout-hdr': return <span className="cny-wcorner" aria-hidden="true"><Blossom className="cny-blossom-tl" /><HangingLantern len={22} className="cny-hang-w" /></span>
    case 'rest-timer': return <RestConfetti />
    case 'finish': return <span className="cny-finish" aria-hidden="true"><Lantern className="cny-lantern-l" /><Lantern className="cny-lantern-r" /></span>
    default: return null
  }
}

const HEADER_BLOSSOMS = [[8, 0, 9, 8], [27, 1.3, 7, 10], [51, 2.6, 11, 7], [73, .6, 8, 12], [91, 2.1, 6, 6]]

// A few blossoms drift down behind a header's title, three passes, then the sky stays quiet.
function Blossoms() {
  const still = reducedMotion()
  return <div className={'cny-hblossoms' + (still ? ' cny-still' : '')} aria-hidden="true">
    {HEADER_BLOSSOMS.map(([x, delay, size, drift], i) => (
      <span key={i} className={'cny-hblossom cny-hb' + i} style={{ '--x': x + '%', '--delay': delay + 's', '--size': size + 'px', '--drift': drift + 'px' }}><Blossom /></span>
    ))}
  </div>
}

// Four confetti pieces along the rest bar's top edge, once each time the bar appears.
function RestConfetti() {
  if (reducedMotion()) return null
  return <span className="cny-restconfetti" aria-hidden="true">
    {[0, 1, 2, 3].map(i => <span key={i} className={'cny-rconf cny-rc' + i} style={{ '--c': `var(--cny-c${i % 3 + 1})` }} />)}
  </span>
}

// A small garland of gold coins across the activity card's top-right corner.
function CoinGarland() {
  return <span className="cny-garland" aria-hidden="true">
    {[0, 1, 2, 3, 4].map(i => <span key={i} className={'cny-gcoin cny-gc' + i}><Coin /></span>)}
  </span>
}

// Said when the red envelope is found: one a day, the same one all day.
const MESSAGES = [
  'A red envelope! You found it. Happy New Year.',
  'A red envelope! Good fortune for your next set.',
  'A red envelope! The lion dance left it here.',
  'A red envelope! May your lifts be lucky all year.',
]

function PeekEnvelope() {
  const ref = useRef(null)
  const [burst, setBurst] = useState(null)
  const [hop, setHop] = useState(0)
  useEffect(() => {
    if (!burst) return
    const tm = setTimeout(() => setBurst(null), 1400)
    return () => clearTimeout(tm)
  }, [burst])
  const tap = e => {
    // The card it hides behind opens the calendar; the envelope is its own thing.
    e.stopPropagation()
    const toast = useUI.getState().toast
    setHop(h => h + 1)
    if (!doneToday('red-envelope') && onceToday('red-envelope')) {
      const r = ref.current?.getBoundingClientRect()
      if (r && !reducedMotion()) setBurst({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
      // A little lucky jingle: two short taps, on whatever this device can buzz.
      vibrate([20, 45, 20])
      toast(t(MESSAGES[new Date().getDate() % MESSAGES.length]))
    } else toast(t('The red envelope is resting until tomorrow. The lanterns are still lit.'))
  }
  return <>
    <span className="cny-peek" aria-hidden="true">
      <button type="button" ref={ref} key={hop} className={'cny-envelope' + (hop ? ' cny-hop' : '')} tabIndex={-1} aria-hidden="true"
        onClick={tap} onKeyDown={e => e.stopPropagation()}><Envelope /></button>
    </span>
    {burst && <div className="cny-burstbox" aria-hidden="true" style={{ left: burst.x, top: burst.y }}>
      {BURST.map(([dx, dy, r, c], i) => <span key={i} className="cny-burstbit" style={{ '--dx': dx + 'px', '--dy': dy + 'px', '--r': r + 'deg', '--c': `var(--cny-c${c + 1})`, animationDelay: i * 35 + 'ms' }} />)}
    </div>}
  </>
}
// Where each confetti piece of the burst ends up, relative to the envelope.
const BURST = [[-120, -150, -18, 0], [-60, -210, -8, 1], [10, -240, 4, 2], [80, -190, 12, 0], [140, -120, 20, 1], [-150, -60, -24, 2], [160, -40, 26, 0]]
