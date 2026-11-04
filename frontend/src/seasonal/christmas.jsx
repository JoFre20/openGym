import { useEffect, useRef, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { vibrate } from '../lib/sound.js'
import { onceToday, doneToday, reducedMotion } from '../lib/seasonal.js'
import './christmas.css'

/* Christmas (v1.4.4), fetched only while the theme shows (components/Seasonal.jsx). All of it is
   hand-drawn inline SVG, moved with CSS transforms and opacity only: no rAF loop, nothing that
   lays the page out again, and every animation has an end. Everything is aria-hidden and lets
   taps through, except the gift, which is the point. Never on the workout screen: App.jsx hides
   the layer there, and nothing on the workout screen can be tapped. */

/* ---------------------------------------------------------------- art -- */

const Flake = ({ className = '' }) => (
  <svg className={'xm-flakesvg ' + className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M12 2.8v18.4M4 7.4l16 9.2M20 7.4 4 16.6" />
    <path d="m12 5.6-1.9-1.9M12 5.6l1.9-1.9M12 18.4l-1.9 1.9M12 18.4l1.9 1.9" />
    <path d="m7.4 9.9-2.9-.7M7.4 9.9l-2.9.7M16.6 14.1l2.9.7M16.6 14.1l2.9-.7M16.6 9.9l2.9-.7M16.6 9.9l2.9.7M7.4 14.1l-2.9.7M7.4 14.1l-2.9-.7" />
  </svg>
)

const Tree = ({ className = '' }) => (
  <svg className={'xm-treesvg ' + className} viewBox="0 0 48 58" aria-hidden="true" focusable="false">
    <path className="xm-trunk" d="M21.5 47h5v9h-5Z" />
    <path className="xm-fir" d="M24 9.8 17.8 21c2 1.2 4 1.2 6.2 0 2.2 1.2 4.2 1.2 6.2 0Z" />
    <path className="xm-fir-2" d="M24 9.8 20.4 16c2.2-1 4.8-1 7.2 0Z" />
    <path className="xm-fir" d="M24 17.2 14.2 31.4c2.6 1.6 5.4 1.6 8 0 2.6 1.6 5.4 1.6 8 0Z" />
    <path className="xm-fir-2" d="M24 17.2 18.4 27c3.6-1.4 7.6-1.4 11.2 0Z" />
    <path className="xm-fir" d="M24 27.6 10 45.8c3.8 2.2 8.2 2.2 12 0 3.8 2.2 8.2 2.2 12 0Z" />
    <path className="xm-fir-2" d="M24 27.6 15.6 39.8c5.4-2 11.4-2 16.8 0Z" />
    <path className="xm-fir-snow" d="M24 9.2 20.6 16.4c2.2-1 4.6-1 6.8 0Z" />
    <path className="xm-garland" d="M14.8 33.8c6 1.8 12.4 1.8 18.4 0M10.8 47.2c8 2.2 18.4 2.2 26.4 0" />
    <circle className="xm-ornament" cx="18.8" cy="22.6" r="1.3" />
    <circle className="xm-ornament xm-ornament-gold" cx="29.2" cy="23.8" r="1.3" />
    <circle className="xm-ornament" cx="16.8" cy="34.6" r="1.4" />
    <circle className="xm-ornament xm-ornament-gold" cx="31.2" cy="36.4" r="1.4" />
    <circle className="xm-ornament" cx="21.2" cy="44.8" r="1.5" />
    <circle className="xm-ornament xm-ornament-gold" cx="28.2" cy="45.6" r="1.3" />
    <path className="xm-star" d="m24 1.2 1.4 3.2 3.5.3-2.6 2.3.8 3.4-3.1-1.8-3.1 1.8.8-3.4-2.6-2.3 3.5-.3Z" />
  </svg>
)

const Bauble = ({ className = '' }) => (
  <svg className={'xm-baublesvg ' + className} viewBox="0 0 24 32" aria-hidden="true" focusable="false">
    <path className="xm-cap" d="M9.2 4.4h5.6v3.2H9.2Z" />
    <path className="xm-loop" d="M10 3.2a2 2 0 0 1 4 0" />
    <circle className="xm-ball" cx="12" cy="16" r="9.2" />
    <path className="xm-shine" d="M7.6 12.4c.6-2.5 2.2-4.2 4.6-5" />
  </svg>
)

// A small Santa head for the Friends page, and the full sleigh below.
const SantaHead = ({ className = '' }) => (
  <svg className={'xm-santahead ' + className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <circle className="xm-santa-face" cx="12" cy="12.4" r="6.2" />
    <path className="xm-santa-beard" d="M5.4 13.8c.8 4.8 3.5 7.4 6.6 7.4s5.8-2.6 6.6-7.4c-1.6 1.2-3 1.8-4.6 2.1-1.3.2-2.7.2-4 0-1.6-.3-3-.9-4.6-2.1Z" />
    <path className="xm-santa-hat" d="M6.3 9.7c.2-4.2 3.2-6.8 6.8-6.7 3.1.1 5.2 2 5.9 4.8-3.8-1.4-8.9-1.4-12.7 0Z" />
    <path className="xm-santa-white" d="M5.1 10.1c3.8-1.6 9.8-1.6 13.8 0l-.3 1.6c-3.8-1.4-9.4-1.4-13.2 0Z" />
    <circle className="xm-santa-pom" cx="5.2" cy="8.2" r="1.6" />
    <circle className="xm-santa-eye" cx="9.4" cy="12" r=".7" /><circle className="xm-santa-eye" cx="14.6" cy="12" r=".7" />
    <path className="xm-santa-nose" d="M11.4 13.3h1.2l-.6 1Z" />
    <path className="xm-santa-mustache" d="M10.4 14.4c.5-.4 1.1-.4 1.6 0M12.2 14.4c.5-.4 1.1-.4 1.6 0" />
  </svg>
)

const Reindeer = ({ x = 0, y = 32, scale = 0.72, lead = false }) => (
  <g transform={`translate(${x} ${y}) scale(${scale})`}>
    <path className="xm-deer-leg" d="M35 51c-4 9-7 16-5 24M42 53c-1 10 0 17 4 23M58 50c5 8 7 15 5 23M64 47c5 8 6 15 4 22" />
    <path className="xm-deer-hoof" d="M30 75l5 1M46 76l5 1M63 73l5 1M68 69l5 1" />
    <path className="xm-deer-body" d="M8 29c0-6 4-10 9-10 4 0 7 2 9 5 3-4 7-6 11-4 5 2 7 8 8 16 6-2 14-1 19 4 7 6 7 16-1 20-7 4-16 2-22-3-6-5-8-11-10-16-2-4-5-6-8-6-4 1-8 3-12 2-5-1-8-3-8-8Z" />
    <path className="xm-deer-light" d="M18 20c3-2 6-2 9 1 3 3 4 8 5 14 1 5 3 9 7 12-5 4-12 3-16-2-4-5-5-11-3-17 1-3 0-6-2-8Z" opacity=".55" />
    <path className="xm-deer-mane" d="M28 19c5 2 7 7 8 13" />
    <path className="xm-deer-harness" d="M28 36c8 7 20 10 31 7M31 26c4 2 8 2 12 0M52 42l8 10" />
    <circle className="xm-deer-eye" cx="14" cy="25" r="1.4" />
    <circle className="xm-deer-nose" cx="7" cy="31" r="2.2" />
    <path className="xm-deer-body" d="M68 40c6-3 11 0 10 5-1 4-5 6-9 4Z" />
    <path className="xm-deer-antler" d="M25 11c-2-8 0-13 5-16M26 9l-9-5M27 8l9-5M32 15c2-7 5-10 10-11M34 14l3-8" />
    <path className="xm-deer-light" d="M20 16c2-4 5-5 8-4 2 1 2 4 0 6Z" />
    <path className="xm-deer-highlight" d="M40 31c6-3 13-2 18 1" />
    {lead && <><circle className="xm-rudolph-glow" cx="7" cy="31" r="4.6" /><circle className="xm-rudolph-nose" cx="7" cy="31" r="2.6" /></>}
  </g>
)

const SantaSleigh = ({ className = '' }) => (
  <svg className={'xm-sleighsvg ' + className} viewBox="0 0 340 136" aria-hidden="true" focusable="false">
    <Reindeer x={4} y={32} lead />
    <Reindeer x={62} y={32} />
    <Reindeer x={120} y={32} />
    <path className="xm-reins" d="M198 58c-22 4-38 3-54-2M120 56c-16 3-30 2-44-1M62 55c-14 2-26 1-38-2" />
    <g transform="translate(196 38)">
      <path className="xm-sleigh-runner" d="M4 80c0 9 7 14 16 14h88c10 0 16-5 16-15" />
      <path className="xm-sleigh-runner" d="M4 72c0 9 7 14 16 14h88c10 0 16-5 16-15" opacity=".55" />
      <path className="xm-sleigh-body" d="M18 38c4-14 16-22 32-22h46c14 0 24 8 26 22l4 20c1 10-6 18-17 18H38c-13 0-21-8-20-18Z" />
      <path className="xm-sleigh-dark" d="M18 58c2 10 10 16 22 16h72c11 0 18-7 19-16Z" />
      <path className="xm-sleigh-trim" d="M20 38c4-12 15-20 30-20h46c12 0 21 7 24 18" />
      <path className="xm-sleigh-trim" d="M38 42h70" opacity=".8" />
      <path className="xm-sleigh-trim" d="M122 38c6-2 10 2 9 8-1 5-5 8-10 7" opacity=".9" />
      <path className="xm-sack" d="M92 40c-4-10 2-17 11-17 9 0 14 7 11 17l-3 17c-1 6-5 9-9 9s-9-3-10-9Z" />
      <path className="xm-sack-light" d="M96 32c3-3 7-4 11-1" />
      <path className="xm-sleigh-trim" d="M95 31c4 2 10 2 15 0" />
      <path className="xm-santa-body" d="M44 40c0-9 6-15 14-15 8 0 14 6 14 15v18c0 6-4 9-10 9h-8c-6 0-10-3-10-9Z" />
      <path className="xm-santa-white" d="M44 54c8 3 20 3 28 0" opacity=".95" />
      <path className="xm-santa-belt" d="M44 57h28v5H44Z" />
      <path className="xm-santa-buckle" d="M56 57h4v5h-4Z" />
      <path className="xm-santa-body" d="M72 43c6 1 9 5 9 10l-5 4c-1-4-3-7-6-9Z" />
      <circle className="xm-santa-face" cx="58" cy="27" r="8" />
      <path className="xm-santa-beard" d="M51 29c1 8 12 9 14 0-2 7-12 8-14 0Z" />
      <path className="xm-santa-hat" d="M50 24c1-8 8-12 15-10 5 1 7 5 7 9l-6 2-2-4-4 4Z" />
      <circle className="xm-santa-pom" cx="48" cy="20" r="2.5" />
      <circle className="xm-santa-eye" cx="55" cy="27" r=".8" /><circle className="xm-santa-eye" cx="61" cy="27" r=".8" />
      <path className="xm-santa-nose" d="M57 29h2l-1 1.4Z" />
      <path className="xm-santa-boot" d="M48 67h8v6h-8ZM72 67h8v6h-8Z" />
    </g>
  </svg>
)

const Gift = () => (
  <svg className="xm-giftsvg" viewBox="0 0 40 34" aria-hidden="true" focusable="false">
    <rect className="xm-box" x="5.4" y="13" width="29.2" height="19.6" rx="2.4" />
    <rect className="xm-lid" x="2.8" y="8" width="34.4" height="7" rx="2" />
    <path className="xm-ribbon" d="M17.4 8h5.2v24.6h-5.2Z" />
    <path className="xm-bow" d="M20 8c-2.2-5.2-8.6-5.8-8.9-1.6-.2 3.1 5.3 3.3 8.9 1.6Zm0 0c2.2-5.2 8.6-5.8 8.9-1.6.2 3.1-5.3 3.3-8.9 1.6Z" />
  </svg>
)

const Star = () => (
  <svg className="xm-starsvg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="m12 2.6 2.7 6.2 6.7.6-5.1 4.5 1.5 6.6-5.8-3.5-5.8 3.5 1.5-6.6-5.1-4.5 6.7-.6Z" />
  </svg>
)

const LIGHTS = [[18, 0], [38, .35], [58, .7], [78, 1.05], [98, 1.4]]

const Lights = () => (
  <span className="xm-lights" aria-hidden="true">
    <svg viewBox="0 0 120 20" preserveAspectRatio="none" focusable="false">
      <path className="xm-wire" d="M0 3c22 13 98 13 120 0" />
      {LIGHTS.map(([x, delay], i) => <circle key={x} className={'xm-bulb xm-bulb-' + (i % 3)} cx={x} cy={i % 2 ? 12.4 : 11} r="2.2" style={{ animationDelay: delay + 's' }} />)}
    </svg>
  </span>
)

const HangingBauble = ({ len = 28, className = '' }) => (
  <span className={'xm-hang ' + className} style={{ '--len': len + 'px' }} aria-hidden="true">
    <span className="xm-hangthread" /><Bauble />
  </span>
)

/* -------------------------------------------------------- the layer -- */

// A short snowfall at every start of the app, and again when it comes back to the front after
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

const FLAKES = [
  [4, 0, 9.5, 16, 10], [9, 2.2, 12, -20, 7], [14, .8, 10.4, 24, 8],
  [20, 3.4, 13, -14, 6], [26, 1.4, 9, 18, 9], [31, 4.2, 11.5, -22, 7],
  [37, .3, 10, 12, 11], [43, 2.8, 12.6, 26, 6], [49, 1.8, 9.8, -16, 8],
  [55, 4.6, 11, 20, 9], [61, .6, 13.2, -24, 7], [67, 3.1, 10.2, 14, 10],
  [73, 1.1, 12.2, -18, 8], [79, 4.9, 9.4, 22, 6], [85, 2.5, 11.8, -12, 9],
  [91, .2, 10.8, 18, 7], [96, 3.8, 12.8, -20, 8],
]

// Santa and his reindeer team fly in from above. The glow on Rudolph's nose is CSS, not a filter
// on the whole picture, so it stays cheap.
function SantaFlight({ still }) {
  if (still) return <div className="xm-santa-still" aria-hidden="true"><SantaSleigh /></div>
  return <div className="xm-santa-flight" aria-hidden="true"><SantaSleigh /></div>
}

/** Snow and Santa at every start, and after a long while away. Nothing while `hidden` (workout). */
export function Layer({ hidden, fresh, effects = true }) {
  const [snow, setSnow] = useState(false)
  const [santa, setSanta] = useState(null)   // null | 'fly' | 'still'
  const hiddenNow = useRef(hidden)
  hiddenNow.current = hidden
  useEffect(() => {
    if (hidden) { setSnow(false); setSanta(null); return }
    if (!effects) setSnow(false)
    const still = reducedMotion()
    const start = () => {
      setSnow(effects && !still)
      setSanta(still ? 'still' : 'fly')
    }
    if (fresh) start()
    const back = () => { if (!hiddenNow.current) start() }
    onReturn.add(back)
    return () => { onReturn.delete(back) }
  }, [hidden, fresh, effects])
  useEffect(() => {
    if (!snow) return
    const tm = setTimeout(() => setSnow(false), 14000)
    return () => clearTimeout(tm)
  }, [snow])
  useEffect(() => {
    if (!santa) return
    const tm = setTimeout(() => setSanta(null), santa === 'still' ? 4000 : 9000)
    return () => clearTimeout(tm)
  }, [santa])
  if (hidden) return null
  return <>
    {snow && <div className="xm-snow" aria-hidden="true">
      {FLAKES.map(([x, delay, dur, drift, size], i) => (
        <span key={i} className="xm-flake" style={{ '--x': x + '%', '--delay': delay + 's', '--dur': dur + 's', '--drift': drift + 'px', '--size': size + 'px' }}><Flake /></span>
      ))}
    </div>}
    {santa && <SantaFlight still={santa === 'still'} />}
  </>
}

/* ----------------------------------------------------- the spots -- */

/** Decoration for one place in a view. Unknown spots draw nothing. */
export function Deco({ spot }) {
  switch (spot) {
    case 'friends': return <span className="xm-friends" aria-hidden="true"><SantaHead /></span>
    case 'header-bats': return <SnowHeader />
    case 'home-hero': return <Tree className="xm-tree-br" />
    case 'plan-card': return <Flake className="xm-flake-tr" />
    case 'home-streak': return <PeekGift />
    // Stats: snow and a star in the header, two baubles hanging into the lifetime tile, a string
    // of lights on the activity card, a snowflake in the corner and two gifts peeking above a card.
    case 'stats-hdr': return <><SnowHeader /><Star /></>
    case 'stats-tile': return <span className="xm-tilebaubles" aria-hidden="true"><HangingBauble len={30} /><HangingBauble len={14} className="xm-hang-b" /></span>
    case 'stats-heatmap': return <Lights />
    case 'stats-web': return <Flake className="xm-flake-bl" />
    case 'stats-peek': return <span className="xm-peek xm-peek-two" aria-hidden="true"><span className="xm-gift-wrap"><Gift /></span><span className="xm-gift-wrap xm-gift-s"><Gift /></span></span>
    // The workout screen: nothing there can be tapped, and nothing sits on a set, a button,
    // a timer, the chip row or an exercise picture. The snowflake and the bauble sit in the
    // page's side gutter, the snow drifts along the rest bar, and two trees flank the finish trophy.
    case 'workout-hdr': return <span className="xm-wcorner" aria-hidden="true"><Flake className="xm-flake-tl" /><HangingBauble len={22} className="xm-hang-w" /></span>
    case 'rest-timer': return <RestSnow />
    case 'finish': return <span className="xm-finish" aria-hidden="true"><Tree className="xm-tree-l" /><Tree className="xm-tree-r" /></span>
    default: return null
  }
}

const HEADER_FLAKES = [[8, 0, 9, 8], [27, 1.3, 7, 10], [51, 2.6, 11, 7], [73, .6, 8, 12], [91, 2.1, 6, 6]]

// A few flakes drift down behind a header's title, three passes, then the sky stays quiet.
function SnowHeader() {
  const still = reducedMotion()
  return <div className={'xm-hdrflakes' + (still ? ' xm-still' : '')} aria-hidden="true">
    {HEADER_FLAKES.map(([x, delay, size, drift], i) => (
      <span key={i} className={'xm-hflake xm-hl' + i} style={{ '--x': x + '%', '--delay': delay + 's', '--size': size + 'px', '--drift': drift + 'px' }}><Flake /></span>
    ))}
  </div>
}

// Three flakes along the rest bar's top edge, once each time the bar appears.
function RestSnow() {
  if (reducedMotion()) return null
  return <span className="xm-restsnow" aria-hidden="true">
    {[0, 1, 2].map(i => <span key={i} className={'xm-rflake xm-rf' + i}><Flake /></span>)}
  </span>
}

// Said when the gift is found: one a day, the same one all day.
const WISHES = [
  'A gift! You found it. Merry lifting.',
  'A gift! One extra rep inside. Redeem it whenever.',
  'A gift! The snowman wrapped this one himself.',
  'A gift! It was under the tree the whole time.',
]

function PeekGift() {
  const ref = useRef(null)
  const [burst, setBurst] = useState(null)
  const [hop, setHop] = useState(0)
  useEffect(() => {
    if (!burst) return
    const tm = setTimeout(() => setBurst(null), 1400)
    return () => clearTimeout(tm)
  }, [burst])
  const tap = e => {
    // The card it hides behind opens the calendar; the gift is its own thing.
    e.stopPropagation()
    const toast = useUI.getState().toast
    setHop(h => h + 1)
    if (!doneToday('gift') && onceToday('gift')) {
      const r = ref.current?.getBoundingClientRect()
      if (r && !reducedMotion()) setBurst({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
      // A little jingle: two short taps, on whatever this device can buzz.
      vibrate([20, 45, 20])
      toast(t(WISHES[new Date().getDate() % WISHES.length]))
    } else toast(t('The gift is resting until tomorrow. Even wrapping paper needs a break.'))
  }
  return <>
    <span className="xm-peek" aria-hidden="true">
      <button type="button" ref={ref} key={hop} className={'xm-gift' + (hop ? ' xm-hop' : '')} tabIndex={-1} aria-hidden="true"
        onClick={tap} onKeyDown={e => e.stopPropagation()}><Gift /></button>
    </span>
    {burst && <div className="xm-burst" aria-hidden="true" style={{ left: burst.x, top: burst.y }}>
      {BURST.map(([dx, dy, r], i) => <span key={i} className="xm-burstflake" style={{ '--dx': dx + 'px', '--dy': dy + 'px', '--r': r + 'deg', animationDelay: i * 35 + 'ms' }}><Flake /></span>)}
    </div>}
  </>
}
// Where each flake of the burst ends up, relative to the gift: mostly up and out.
const BURST = [[-120, -150, -18], [-60, -210, -8], [10, -240, 4], [80, -190, 12], [140, -120, 20], [-150, -60, -24], [160, -40, 26]]
