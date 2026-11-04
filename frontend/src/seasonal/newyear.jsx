import { useEffect, useRef, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { vibrate } from '../lib/sound.js'
import { onceToday, doneToday, reducedMotion } from '../lib/seasonal.js'
import './newyear.css'

/* New Year's Eve (v1.4.4), fetched only while the theme shows (components/Seasonal.jsx). All of it
   is hand-drawn inline SVG, moved with CSS transforms and opacity only: no rAF loop, nothing that
   lays the page out again, and every animation has an end. Everything is aria-hidden and lets
   taps through, except the popper, which is the point. Never on the workout screen: App.jsx hides
   the layer there, and nothing on the workout screen can be tapped. */

/* ---------------------------------------------------------------- art -- */

const Firework = ({ className = '' }) => (
  <svg className={'ny-fwsvg ' + className} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <defs>
      <radialGradient id="ny-fw-glow">
        <stop className="ny-glow-stop-a" offset="0" />
        <stop className="ny-glow-stop-b" offset=".55" />
        <stop className="ny-glow-stop-c" offset="1" />
      </radialGradient>
    </defs>
    <circle fill="url(#ny-fw-glow)" cx="32" cy="32" r="17" />
    <g className="ny-rays">
      <path d="M32 3v14M32 47v14M3 32h14M47 32h14M11.5 11.5l9.9 9.9M42.6 42.6l9.9 9.9M52.5 11.5 42.6 21.4M21.4 42.6 11.5 52.5" />
    </g>
    <g className="ny-rays-2">
      <path d="M32 12v6M32 46v6M12 32h6M46 32h6M18 18l4.2 4.2M41.8 41.8 46 46M46 18l-4.2 4.2M22.2 41.8 18 46" />
    </g>
    <circle className="ny-core" cx="32" cy="32" r="4.2" />
    <circle className="ny-core-2" cx="32" cy="32" r="1.5" />
    <g>
      <circle className="ny-spark" cx="9" cy="26" r="1.4" /><circle className="ny-spark" cx="53" cy="38" r="1.2" />
      <circle className="ny-spark" cx="24" cy="8" r="1.1" /><circle className="ny-spark" cx="42" cy="55" r="1.3" />
      <circle className="ny-spark" cx="17" cy="50" r="1" /><circle className="ny-spark" cx="50" cy="17" r="1" />
    </g>
    <g>
      <circle className="ny-spark-2" cx="5" cy="40" r="1.1" /><circle className="ny-spark-2" cx="56" cy="24" r="1" />
      <circle className="ny-spark-2" cx="39" cy="5" r="1" /><circle className="ny-spark-2" cx="27" cy="59" r="1.2" />
    </g>
    <g>
      <circle className="ny-spark-3" cx="34" cy="2" r="1" /><circle className="ny-spark-3" cx="61" cy="33" r=".9" />
      <circle className="ny-spark-3" cx="2" cy="30" r="1" /><circle className="ny-spark-3" cx="30" cy="62" r=".9" />
    </g>
    <path className="ny-trail" d="M32 10c2 4 3 8 2 12M54 32c-4 2-8 3-12 2M32 54c-2-4-3-8-2-12M10 32c4-2 8-3 12-2" />
  </svg>
)

const Glass = ({ className = '' }) => (
  <svg className={'ny-glasssvg ' + className} viewBox="0 0 28 52" aria-hidden="true" focusable="false">
    <path className="ny-bowl" d="M5.6 4.2h16.8l-1.5 12.4c-.4 3.6-3.2 6.2-6.9 6.2s-6.5-2.6-6.9-6.2Z" />
    <path className="ny-champagne" d="M7.4 6.2h13.2l-1.2 10.2c-.3 2.9-2.6 5-5.4 5s-5.1-2.1-5.4-5Z" />
    <path className="ny-rim" d="M5.3 3.9h17.4" />
    <path className="ny-stem" d="M14 22.8v19.4" />
    <path className="ny-base" d="M9.2 45.8c3.2-1.4 6.4-1.4 9.6 0" />
    <circle className="ny-bubble" cx="10" cy="10" r="1" /><circle className="ny-bubble" cx="15.4" cy="15.4" r=".9" />
    <circle className="ny-bubble" cx="12.2" cy="18.4" r=".7" /><circle className="ny-bubble" cx="17" cy="9.2" r=".7" />
  </svg>
)

const Popper = ({ className = '' }) => (
  <svg className={'ny-poppersvg ' + className} viewBox="0 0 52 48" aria-hidden="true" focusable="false">
    <path className="ny-cone" d="M7.4 40 25 20.4l6.8 11.2Z" />
    <path className="ny-cone-rim" d="m7.4 40 7-7.8 6.4 3.4" />
    <path className="ny-streamer" d="M31 19c5-6 11-9 17-9-4 4-6 8-5 13M30 16c0-6 2-11 6-15" />
    <path className="ny-streamer ny-streamer-2" d="M34 22c4-3 8-4 12-3" />
    <circle className="ny-conf" cx="48" cy="7" r="1.5" /><circle className="ny-conf ny-conf-2" cx="38" cy="3" r="1.2" />
    <circle className="ny-conf ny-conf-3" cx="44" cy="18" r="1.1" />
    <rect className="ny-conf" x="30" y="4" width="2.6" height="4" rx=".6" transform="rotate(28 31 6)" />
    <rect className="ny-conf ny-conf-3" x="35" y="9" width="2.2" height="3.6" rx=".6" transform="rotate(-18 36 11)" />
  </svg>
)

const Star = ({ className = '' }) => (
  <svg className={'ny-starsvg ' + className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="m12 2.6 2.7 6.2 6.7.6-5.1 4.5 1.5 6.6-5.8-3.5-5.8 3.5 1.5-6.6-5.1-4.5 6.7-.6Z" />
  </svg>
)

const Clock = ({ className = '' }) => (
  <svg className={'ny-clocksvg ' + className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <circle cx="12" cy="12" r="8.4" />
    <path d="M12 7.2V12h3.4" />
  </svg>
)

const PartyHat = ({ className = '' }) => (
  <svg className={'ny-hatsvg ' + className} viewBox="0 0 30 34" aria-hidden="true" focusable="false">
    <path className="ny-hat" d="M15 2.8 4.4 29.6h21.2Z" />
    <path className="ny-hat-band" d="M8.4 21.4h13.2" />
    <circle className="ny-pom" cx="15" cy="2.6" r="2.2" />
    <path className="ny-hat-stripes" d="M11 10.6 9 15.4M18.4 14.2l-1.8 4.2" />
  </svg>
)

const HangingStar = ({ len = 28, className = '' }) => (
  <span className={'ny-hang ' + className} style={{ '--len': len + 'px' }} aria-hidden="true">
    <span className="ny-hangthread" /><Star />
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
const CONFETTI = Array.from({ length: 22 }, (_, i) => [
  (i * 37 + 5) % 96,
  ((i * 13) % 50) / 10,
  9 + (i % 6),
  ((i % 7) - 3) * 8,
  4 + (i % 3) * 2,
  7 + (i % 4) * 2,
  i % 4,
])

const BURSTS = [[18, 96, 0, 76], [48, 158, 1.2, 100], [76, 74, 2.4, 68]]

function Fireworks({ still }) {
  return <div className={'ny-fireworks' + (still ? ' ny-fireworks-still' : '')} aria-hidden="true">
    {BURSTS.map(([x, y, delay, size], i) => (
      <span key={i} className="ny-firework" style={{ '--x': x + '%', '--y': y + 'px', '--delay': delay + 's', '--size': size + 'px' }}><Firework /></span>
    ))}
  </div>
}

/** Confetti and fireworks at every start, and after a long while away. Nothing while `hidden`. */
export function Layer({ hidden, fresh, effects = true }) {
  const [fall, setFall] = useState(false)
  const [fireworks, setFireworks] = useState(null)   // null | 'show' | 'still'
  const hiddenNow = useRef(hidden)
  hiddenNow.current = hidden
  useEffect(() => {
    if (hidden) { setFall(false); setFireworks(null); return }
    if (!effects) setFall(false)
    const still = reducedMotion()
    const start = () => {
      setFall(effects && !still)
      setFireworks(still ? 'still' : 'show')
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
    if (!fireworks) return
    const tm = setTimeout(() => setFireworks(null), fireworks === 'still' ? 4000 : 6500)
    return () => clearTimeout(tm)
  }, [fireworks])
  if (hidden) return null
  return <>
    {fall && <div className="ny-fall" aria-hidden="true">
      {CONFETTI.map(([x, delay, dur, drift, w, h, c], i) => (
        <span key={i} className="ny-confetti" style={{ '--x': x + '%', '--delay': delay + 's', '--dur': dur + 's', '--drift': drift + 'px', '--w': w + 'px', '--h': h + 'px', '--c': `var(--ny-c${c + 1})` }} />
      ))}
    </div>}
    {fireworks && <Fireworks still={fireworks === 'still'} />}
  </>
}

/* ----------------------------------------------------- the spots -- */

/** Decoration for one place in a view. Unknown spots draw nothing. */
export function Deco({ spot }) {
  switch (spot) {
    case 'friends': return <span className="ny-friends" aria-hidden="true"><Firework /></span>
    case 'header-bats': return <Sparkles />
    case 'home-hero': return <Glass className="ny-glass-br" />
    case 'plan-card': return <Firework className="ny-fw-tr" />
    case 'home-streak': return <PeekPopper />
    // Stats: stars and a midnight clock in the header, hanging stars in the lifetime tile, a
    // garland of stars on the activity card, a firework in the corner and two hats peeking above.
    case 'stats-hdr': return <><Sparkles /><Clock className="ny-hdrclock" /></>
    case 'stats-tile': return <span className="ny-tilestars" aria-hidden="true"><HangingStar len={30} /><HangingStar len={14} className="ny-hang-b" /></span>
    case 'stats-heatmap': return <StarsGarland />
    case 'stats-web': return <Firework className="ny-fw-bl" />
    case 'stats-peek': return <span className="ny-peek ny-peek-two" aria-hidden="true"><span className="ny-hat-wrap"><PartyHat /></span><span className="ny-hat-wrap ny-hat-s"><PartyHat /></span></span>
    // The workout screen: nothing there can be tapped, and nothing sits on a set, a button,
    // a timer, the chip row or an exercise picture. The firework and the star sit in the page's
    // side gutter, confetti drifts along the rest bar, and two poppers flank the finish trophy.
    case 'workout-hdr': return <span className="ny-wcorner" aria-hidden="true"><Firework className="ny-fw-tl" /><HangingStar len={22} className="ny-hang-w" /></span>
    case 'rest-timer': return <RestConfetti />
    case 'finish': return <span className="ny-finish" aria-hidden="true"><Popper className="ny-popper-l" /><Popper className="ny-popper-r" /></span>
    default: return null
  }
}

const SPARKS = [[8, 7, 9, 0], [27, 17, 7, 1.3], [51, 4, 11, 2.6], [73, 14, 8, .6], [91, 8, 6, 2.1]]

// A few stars twinkle behind a header's title, four passes, then the sky stays quiet.
function Sparkles() {
  const still = reducedMotion()
  return <div className={'ny-sparkles' + (still ? ' ny-still' : '')} aria-hidden="true">
    {SPARKS.map(([x, y, size, delay], i) => (
      <span key={i} className={'ny-spark ny-sp' + i} style={{ '--x': x + '%', '--y': y + 'px', '--size': size + 'px', '--delay': delay + 's' }}><Star /></span>
    ))}
  </div>
}

// Three confetti pieces along the rest bar's top edge, once each time the bar appears.
function RestConfetti() {
  if (reducedMotion()) return null
  return <span className="ny-restconfetti" aria-hidden="true">
    {[0, 1, 2, 3].map(i => <span key={i} className={'ny-rconf ny-rc' + i} style={{ '--c': `var(--ny-c${i % 4 + 1})` }} />)}
  </span>
}

// A small garland of stars across the activity card's top-right corner.
function StarsGarland() {
  return <span className="ny-garland" aria-hidden="true">
    {[0, 1, 2, 3, 4].map(i => <span key={i} className={'ny-gstar ny-gs' + i}><Star /></span>)}
  </span>
}

// Said when the popper is found: one a day, the same one all day.
const MESSAGES = [
  'Happy New Year! You found the confetti.',
  'A fresh year, a fresh set. Make it count.',
  'The countdown was only the warm-up.',
  'Confetti! The next rep is the resolution.',
]

function PeekPopper() {
  const ref = useRef(null)
  const [burst, setBurst] = useState(null)
  const [hop, setHop] = useState(0)
  useEffect(() => {
    if (!burst) return
    const tm = setTimeout(() => setBurst(null), 1400)
    return () => clearTimeout(tm)
  }, [burst])
  const tap = e => {
    // The card it hides behind opens the calendar; the popper is its own thing.
    e.stopPropagation()
    const toast = useUI.getState().toast
    setHop(h => h + 1)
    if (!doneToday('confetti') && onceToday('confetti')) {
      const r = ref.current?.getBoundingClientRect()
      if (r && !reducedMotion()) setBurst({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
      // A little pop: two short taps, on whatever this device can buzz.
      vibrate([20, 45, 20])
      toast(t(MESSAGES[new Date().getDate() % MESSAGES.length]))
    } else toast(t('The confetti is resting until tomorrow. Even party poppers need a break.'))
  }
  return <>
    <span className="ny-peek" aria-hidden="true">
      <button type="button" ref={ref} key={hop} className={'ny-popper' + (hop ? ' ny-hop' : '')} tabIndex={-1} aria-hidden="true"
        onClick={tap} onKeyDown={e => e.stopPropagation()}><Popper /></button>
    </span>
    {burst && <div className="ny-burstbox" aria-hidden="true" style={{ left: burst.x, top: burst.y }}>
      {BURST.map(([dx, dy, r, c], i) => <span key={i} className="ny-burstbit" style={{ '--dx': dx + 'px', '--dy': dy + 'px', '--r': r + 'deg', '--c': `var(--ny-c${c + 1})`, animationDelay: i * 35 + 'ms' }} />)}
    </div>}
  </>
}
// Where each confetti piece of the burst ends up, relative to the popper.
const BURST = [[-120, -150, -18, 0], [-60, -210, -8, 1], [10, -240, 4, 2], [80, -190, 12, 3], [140, -120, 20, 0], [-150, -60, -24, 1], [160, -40, 26, 2]]
