import { useEffect, useRef, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { vibrate } from '../lib/sound.js'
import { onceToday, doneToday, reducedMotion } from '../lib/seasonal.js'
import './easter.css'

/* Easter (v1.4.4), fetched only while the theme shows (components/Seasonal.jsx). All of it is
   hand-drawn inline SVG, moved with CSS transforms and opacity only: no rAF loop, nothing that
   lays the page out again, and every animation has an end. Everything is aria-hidden and lets
   taps through, except the egg, which is the point. Never on the workout screen: App.jsx hides
   the layer there, and nothing on the workout screen can be tapped. */

/* ---------------------------------------------------------------- art -- */

const Egg = ({ className = '' }) => (
  <svg className={'ea-eggsvg ' + className} viewBox="0 0 40 50" aria-hidden="true" focusable="false">
    <path className="ea-eggbody" d="M20 2.8C12.8 2.8 6.8 15 6.8 27.2c0 11.6 5.6 19.8 13.2 19.8s13.2-8.2 13.2-19.8C33.2 15 27.2 2.8 20 2.8Z" />
    <path className="ea-eggband" d="M8.2 22.4c3.4 2.6 6.7 2.2 9.8.6 3.1-1.6 6.4-2 9.8.6 1.2.9 2.4 1.4 3.6 1.4M7.4 31.2c4 3 8 2.2 11.6.2 3.6-2 7.6-2.8 11.6.2 1.2.9 2.4 1.4 3.6 1.6" />
    <path className="ea-eggshine" d="M13.6 12.2c1-3.4 2.8-5.6 5.2-6.8" />
    <circle className="ea-eggdot" cx="15" cy="38" r="1.2" />
    <circle className="ea-eggdot" cx="24" cy="41" r="1" />
  </svg>
)

const Bunny = ({ className = '' }) => (
  <svg className={'ea-bunnysvg ' + className} viewBox="0 0 52 58" aria-hidden="true" focusable="false">
    <path className="ea-ear" d="M17.4 23.2c-2.2-7-1.2-14.4 2.2-18.6 3.2 2.2 4.4 9.6 3 16.6M34.6 23.2c2.2-7 1.2-14.4-2.2-18.6-3.2 2.2-4.4 9.6-3 16.6" />
    <path className="ea-ear-in" d="M19.4 22.2c-1.4-5.6-.8-11 .8-14.2 1.8 1.8 2.4 7.2 1.6 12.6M32.6 22.2c1.4-5.6.8-11-.8-14.2-1.8 1.8-2.4 7.2-1.6 12.6" />
    <ellipse className="ea-head" cx="26" cy="31" rx="13.2" ry="12.2" />
    <ellipse className="ea-muzzle" cx="26" cy="36" rx="6.4" ry="4.6" />
    <circle className="ea-eye" cx="20.4" cy="29.4" r="1.2" /><circle className="ea-eye" cx="31.6" cy="29.4" r="1.2" />
    <path className="ea-nose" d="M24.2 34.6h3.6L26 37Z" />
    <path className="ea-whiskers" d="M20.4 35.8 14.8 34M20.6 37.2l-5.4 1.4M31.6 35.8 37.2 34M31.4 37.2l5.4 1.4" />
    <path className="ea-paws" d="M16.4 43c2 1.2 4.2 1.2 6.2 0M29.4 43c2 1.2 4.2 1.2 6.2 0" />
  </svg>
)

const Flower = ({ className = '' }) => (
  <svg className={'ea-flowersvg ' + className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <g className="ea-petals">
      <ellipse cx="12" cy="6.2" rx="3.2" ry="4.2" />
      <ellipse cx="17.8" cy="12" rx="4.2" ry="3.2" />
      <ellipse cx="12" cy="17.8" rx="3.2" ry="4.2" />
      <ellipse cx="6.2" cy="12" rx="4.2" ry="3.2" />
    </g>
    <circle className="ea-center" cx="12" cy="12" r="2.6" />
  </svg>
)

const Petal = ({ className = '' }) => (
  <svg className={'ea-petalsvg ' + className} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
    <path d="M10 2.2c4.4 1.4 7 5.2 6.4 9.4-.6 4.2-4.4 6.6-8.6 5.4C3.6 15.6 2.2 11.8 3.4 8.2 4.4 5.2 6.8 3.2 10 2.2Z" />
  </svg>
)

const RunnerBunny = () => (
  <svg className="ea-runnerbunny" viewBox="0 0 64 48" aria-hidden="true" focusable="false">
    <path className="ea-rb-leg" d="M38 32c-2 5-1 9 3 13M44 33c0 5 2 9 6 12M24 31c-3 5-3 9 1 13M29 31c-1 5 0 9 4 12" />
    <path className="ea-rb-body" d="M17 25c1-10 10-17 21-16 9 1 15 6 16 13 1 6-3 12-10 14-8 3-18 1-23-3-4-3-5-5-4-8Z" />
    <circle className="ea-rb-tail" cx="16" cy="27" r="3.6" />
    <circle className="ea-rb-body" cx="47" cy="18" r="8.5" />
    <path className="ea-rb-light" d="M39 27c3 4 9 5 13 2 4-3 5-7 3-11-1 5-5 8-9 9Z" />
    <path className="ea-rb-ear" d="M43 12C41 5 41 1 44 0c2 0 3 4 3 10Z" />
    <path className="ea-rb-ear" d="M48 12c1-7 3-11 6-10 2 1 1 6-1 11Z" />
    <path className="ea-rb-ear-in" d="M44 10c-1-4-1-7 0-8 1 0 1 3 1 7Z" />
    <path className="ea-rb-ear-in" d="M50 10c1-4 2-7 3-6 1 1 0 4-1 7Z" />
    <circle className="ea-rb-eye" cx="48" cy="17" r="1.2" />
    <path className="ea-rb-nose" d="M55 20c1.5 0 2.4 1 2.4 2.2 0 1.1-1 2-2.4 2Z" />
    <path className="ea-rb-whisker" d="M54 24c1 1 2 1.7 3.4 2" />
    <path className="ea-rb-basket" d="M25 18h9l-1.4 6h-6.2Z" />
    <path className="ea-rb-basket-rim" d="M25 18c1-5 7-5 9 0" />
    <circle className="ea-rb-candy" cx="27" cy="16.6" r="2" />
    <circle className="ea-rb-candy ea-rb-candy-2" cx="32" cy="16" r="2" />
  </svg>
)

const CANDIES = [[12, .8], [28, 1.9], [43, 3.1], [58, 4.2], [72, 5.4], [86, 6.5]]

const MeadowHill = () => (
  <svg className="ea-meadow-hill" viewBox="0 0 400 80" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <path className="ea-hill-back" d="M0 28C60 10 120 34 180 24S300 6 400 26V80H0Z" />
    <path className="ea-hill-front" d="M0 48C50 32 100 52 160 40S280 22 400 44V80H0Z" />
    <g className="ea-grass">
      <path d="M40 46c2-7 5-10 8-12M46 46c0-6 2-9 4-11M90 38c2-6 5-9 8-10M96 38c0-5 2-8 4-10M150 44c2-6 5-9 8-11M156 44c0-5 2-8 4-10M220 38c2-7 5-10 8-12M226 38c0-5 2-8 4-10M300 32c2-6 5-9 8-11M306 32c0-5 2-8 4-10M360 38c2-6 5-9 8-11M366 38c0-5 2-8 4-10" />
    </g>
  </svg>
)

const Candy = ({ className = '' }) => (
  <svg className={'ea-candysvg ' + className} viewBox="0 0 20 12" aria-hidden="true" focusable="false">
    <path className="ea-candy-wrap" d="M2 6 0 2v8ZM18 6l2-4v8Z" />
    <rect className="ea-candy-body" x="4" y="2" width="12" height="8" rx="3.2" />
    <path className="ea-candy-line" d="M8 3v6M12 3v6" />
  </svg>
)

const Meadow = ({ still }) => (
  <div className={'ea-meadow' + (still ? ' ea-meadow-still' : '')} aria-hidden="true">
    <MeadowHill />
    <span className="ea-runner ea-runner-a"><RunnerBunny /></span>
    <span className="ea-runner ea-runner-b"><RunnerBunny /></span>
    {CANDIES.map(([x, delay], i) => (
      <span key={i} className="ea-candy" style={{ '--x': x + '%', '--delay': delay + 's' }}>
        <Candy className={i % 2 ? 'ea-candy-alt' : ''} />
      </span>
    ))}
    {[0, 1, 2, 3, 4].map(i => <span key={i} className={'ea-mflower ea-mf' + i}><Flower /></span>)}
  </div>
)

const HangingEgg = ({ len = 28, className = '' }) => (
  <span className={'ea-hang ' + className} style={{ '--len': len + 'px' }} aria-hidden="true">
    <span className="ea-hangthread" /><Egg />
  </span>
)

/* -------------------------------------------------------- the layer -- */

// A short petal fall at every start of the app, and again when it comes back to the front after
// AWAY_MS or more in the background. Time away is counted here, at module level, so it is right
// however long the layer itself was mounted.
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

const PETALS = [
  [4, 0, 9.5, 16, 10], [9, 2.2, 12, -20, 7], [14, .8, 10.4, 24, 8],
  [20, 3.4, 13, -14, 6], [26, 1.4, 9, 18, 9], [31, 4.2, 11.5, -22, 7],
  [37, .3, 10, 12, 11], [43, 2.8, 12.6, 26, 6], [49, 1.8, 9.8, -16, 8],
  [55, 4.6, 11, 20, 9], [61, .6, 13.2, -24, 7], [67, 3.1, 10.2, 14, 10],
  [73, 1.1, 12.2, -18, 8], [79, 4.9, 9.4, 22, 6], [85, 2.5, 11.8, -12, 9],
  [91, .2, 10.8, 18, 7], [96, 3.8, 12.8, -20, 8],
]

/** Petals and the meadow at every start, and after a long while away. Nothing while `hidden`. */
export function Layer({ hidden, fresh, effects = true }) {
  const [fall, setFall] = useState(false)
  const [meadow, setMeadow] = useState(null)   // null | 'run' | 'still'
  const hiddenNow = useRef(hidden)
  hiddenNow.current = hidden
  useEffect(() => {
    if (hidden) { setFall(false); setMeadow(null); return }
    if (!effects) setFall(false)
    const still = reducedMotion()
    const start = () => {
      setFall(effects && !still)
      setMeadow(still ? 'still' : 'run')
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
    if (!meadow) return
    const tm = setTimeout(() => setMeadow(null), meadow === 'still' ? 4000 : 9500)
    return () => clearTimeout(tm)
  }, [meadow])
  if (hidden) return null
  return <>
    {fall && <div className="ea-fall" aria-hidden="true">
      {PETALS.map(([x, delay, dur, drift, size], i) => (
        <span key={i} className="ea-fpetal" style={{ '--x': x + '%', '--delay': delay + 's', '--dur': dur + 's', '--drift': drift + 'px', '--size': size + 'px' }}><Petal /></span>
      ))}
    </div>}
    {meadow && <Meadow still={meadow === 'still'} />}
  </>
}

/* ----------------------------------------------------- the spots -- */

/** Decoration for one place in a view. Unknown spots draw nothing. */
export function Deco({ spot }) {
  switch (spot) {
    case 'friends': return <span className="ea-friends" aria-hidden="true"><Bunny /></span>
    case 'header-bats': return <Petals />
    case 'home-hero': return <Bunny className="ea-bunny-br" />
    case 'plan-card': return <Egg className="ea-egg-tr" />
    case 'home-streak': return <PeekEgg />
    // Stats: petals and a flower in the header, two eggs hanging into the lifetime tile, a
    // flower garland on the activity card, a flower in the corner and two eggs peeking above a card.
    case 'stats-hdr': return <><Petals /><Flower className="ea-hdrflower" /></>
    case 'stats-tile': return <span className="ea-tileeggs" aria-hidden="true"><HangingEgg len={30} /><HangingEgg len={14} className="ea-hang-b" /></span>
    case 'stats-heatmap': return <FlowerGarland />
    case 'stats-web': return <Flower className="ea-flower-bl" />
    case 'stats-peek': return <span className="ea-peek ea-peek-two" aria-hidden="true"><span className="ea-egg-wrap"><Egg /></span><span className="ea-egg-wrap ea-egg-s"><Egg /></span></span>
    // The workout screen: nothing there can be tapped, and nothing sits on a set, a button,
    // a timer, the chip row or an exercise picture. The flower and the egg sit in the page's
    // side gutter, petals drift along the rest bar, and two eggs flank the finish trophy.
    case 'workout-hdr': return <span className="ea-wcorner" aria-hidden="true"><Flower className="ea-flower-tl" /><HangingEgg len={22} className="ea-hang-w" /></span>
    case 'rest-timer': return <RestPetals />
    case 'finish': return <span className="ea-finish" aria-hidden="true"><Egg className="ea-egg-l" /><Egg className="ea-egg-r" /></span>
    default: return null
  }
}

const HEADER_PETALS = [[8, 0, 9, 8], [27, 1.3, 7, 10], [51, 2.6, 11, 7], [73, .6, 8, 12], [91, 2.1, 6, 6]]

// A few petals drift down behind a header's title, three passes, then the sky stays quiet.
function Petals() {
  const still = reducedMotion()
  return <div className={'ea-hdrpetals' + (still ? ' ea-still' : '')} aria-hidden="true">
    {HEADER_PETALS.map(([x, delay, size, drift], i) => (
      <span key={i} className={'ea-hpetal ea-hp' + i} style={{ '--x': x + '%', '--delay': delay + 's', '--size': size + 'px', '--drift': drift + 'px' }}><Petal /></span>
    ))}
  </div>
}

// Three petals along the rest bar's top edge, once each time the bar appears.
function RestPetals() {
  if (reducedMotion()) return null
  return <span className="ea-restpetals" aria-hidden="true">
    {[0, 1, 2].map(i => <span key={i} className={'ea-rpetal ea-rp' + i}><Petal /></span>)}
  </span>
}

// A small garland of flowers across the activity card's top-right corner.
function FlowerGarland() {
  return <span className="ea-garland" aria-hidden="true">
    {[0, 1, 2, 3, 4].map(i => <span key={i} className={'ea-gflower ea-gf' + i}><Flower /></span>)}
  </span>
}

// Said when the egg is found: one a day, the same one all day.
const EGG_MESSAGES = [
  'An egg! You found it. Happy Easter.',
  'An egg! This one was hiding behind the dumbbells.',
  'An egg! The bunny left it here for you.',
  'An egg! Still warm from the sun.',
]

function PeekEgg() {
  const ref = useRef(null)
  const [burst, setBurst] = useState(null)
  const [hop, setHop] = useState(0)
  useEffect(() => {
    if (!burst) return
    const tm = setTimeout(() => setBurst(null), 1400)
    return () => clearTimeout(tm)
  }, [burst])
  const tap = e => {
    // The card it hides behind opens the calendar; the egg is its own thing.
    e.stopPropagation()
    const toast = useUI.getState().toast
    setHop(h => h + 1)
    if (!doneToday('easter-egg') && onceToday('easter-egg')) {
      const r = ref.current?.getBoundingClientRect()
      if (r && !reducedMotion()) setBurst({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
      // A little spring jingle: two short taps, on whatever this device can buzz.
      vibrate([20, 45, 20])
      toast(t(EGG_MESSAGES[new Date().getDate() % EGG_MESSAGES.length]))
    } else toast(t('The egg is napping until tomorrow. The bunny is hiding the rest.'))
  }
  return <>
    <span className="ea-peek" aria-hidden="true">
      <button type="button" ref={ref} key={hop} className={'ea-egg' + (hop ? ' ea-hop' : '')} tabIndex={-1} aria-hidden="true"
        onClick={tap} onKeyDown={e => e.stopPropagation()}><Egg /></button>
    </span>
    {burst && <div className="ea-burst" aria-hidden="true" style={{ left: burst.x, top: burst.y }}>
      {BURST.map(([dx, dy, r], i) => <span key={i} className="ea-burstpetal" style={{ '--dx': dx + 'px', '--dy': dy + 'px', '--r': r + 'deg', animationDelay: i * 35 + 'ms' }}><Petal /></span>)}
    </div>}
  </>
}
// Where each petal of the burst ends up, relative to the egg: mostly up and out.
const BURST = [[-120, -150, -18], [-60, -210, -8], [10, -240, 4], [80, -190, 12], [140, -120, 20], [-150, -60, -24], [160, -40, 26]]
