import { useSyncExternalStore } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { effectiveRoutineIds, effectiveRoutines } from '../lib/history.js'
import { todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { getSocialPending, subscribeSocialPending } from '../lib/social-badge.js'
import { getLiveRows, subscribeLive } from '../lib/live-badge.js'
import { useLiveBadge } from '../lib/use-live-badge.js'
import { isNewUI, parentTab } from '../lib/ui-mode.js'
import Icon from './Icon.jsx'
import Elapsed from './Elapsed.jsx'
import { useConnectionTrouble } from './SyncBanner.jsx'
import { retapTab } from '../lib/scroll-top.js'

// Module scope, not TabBar's render body. Declared inside it, `Tab` was a new function on every
// render, so React saw a different component type each time and threw the button away and built a
// fresh one — on a bar that is fixed on screen, and once a second for the whole of a rest. The
// state it took with it is the DOM node itself: focus, the :active tint, any in-flight transition.
function Tab({ active, icon, label, onClick, dot, badge = 0, live = false, tour }) {
  const extra = [badge > 0 ? String(badge) : '', live ? t('Live') : '', dot ? t('Connection problem') : ''].filter(Boolean)
  const name = extra.length ? label + ', ' + extra.join(', ') : undefined
  return (
    <button className={active ? 'on' : ''} onClick={onClick} data-tour={tour} aria-label={name}>
      <span className="tab-ic">
        <Icon name={icon} />
        {live && <span className="tab-live-dot" aria-hidden="true" />}
        {dot && <span className="tab-dot" aria-hidden="true" />}
        {badge > 0 && <span className="tab-badge" aria-hidden="true">{badge > 9 ? '9+' : badge}</span>}
      </span>
      <span>{label}</span>
    </button>
  )
}

export default function TabBar({ onStart }) {
  const nav = useNavigate()
  const loc = useLocation()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const isGuest = useStore(s => s.isGuest())
  const pending = useSyncExternalStore(subscribeSocialPending, () => getSocialPending(user?.id), () => 0)
  const liveNow = useSyncExternalStore(subscribeLive, () => getLiveRows(user?.id), () => getLiveRows(user?.id)).length > 0
  // Poll only while a signed-in app is on screen. The Activity screen shares this store.
  useLiveBadge()
  // With the connection banner switched off, a sync problem shows as a dot on Home, the tab
  // Settings lives under (#369, #330).
  const trouble = useConnectionTrouble()
  if (!user && !isGuest) return null
  const cur = loc.pathname.split('/')[1] || 'home'
  // A screen without a tab of its own lights the tab it is opened from (Muscles from both).
  const parent = parentTab(cur, loc.state, S)
  const on = k => cur === k || parent === k
  const fresh = isNewUI(S)

  // Root tabs are peers, not another level to unwind with Android Back. The tab you are already
  // on takes you to the top of its page instead (lib/scroll-top.js).
  const switchTab = path => {
    if (loc.pathname !== path || loc.search) nav(path, { replace: true })
    else retapTab(path)
  }

  const running = !!S.active && cur !== 'workout' && !S.active.editingWorkoutId && !S.active.backfill && S.active.start > 0
  const startWorkout = () => {
    if (!S.active) {
      // A weekday can hold several routines; start the combined session if any of them has
      // exercises, otherwise fall through to the picker.
      if (effectiveRoutines(S, todayISO()).some(r => r.ex.length)) { onStart(effectiveRoutineIds(S, todayISO())); return }
    }
    nav('/workout')
  }

  const planTab = <Tab active={on('plan')} icon="calendar" label={t('Plan')} onClick={() => switchTab('/plan')} tour="tab-plan" />
  const statsTab = <Tab active={on('stats')} icon="chart" label={t('Stats')} onClick={() => switchTab('/stats')} tour="tab-stats" />
  const libraryTab = <Tab active={on('library')} icon="dumbbell" label={t('Exercises')} onClick={() => switchTab('/library')} tour="tab-library" />
  const activityTab = <Tab active={on('social')} icon="people" label={t('Activity')} badge={pending} live={liveNow} onClick={() => switchTab('/social')} tour="tab-activity" />

  return (
    <nav id="tabbar">
      <Tab active={on('home')} icon="house" label={t('Home')} dot={trouble} live={!fresh && liveNow} onClick={() => switchTab('/home')} tour="tab-home" />
      {fresh ? activityTab : planTab}
      {/* On the workout screen itself there is nothing to resume, so the button reads as the
          tab it is and stays lit (#29); anywhere else it brings you back to the exercise you
          were on — the marker is kept in S.active.cur and never moves on its own (#21). The
          glyph is always play: start and resume are one concept, and an exercise is a dumbbell.
          A live session you stepped away from shows its running time instead of a word, the
          button still named Resume; a past workout being edited or logged after the fact has no
          clock to run. */}
      <button data-tour="start" className={'start' + (S.active ? ' rec' : '') + (S.active && cur === 'workout' ? ' on' : '')} onClick={startWorkout}
        aria-label={running ? t('Resume') : undefined}>
        <span className="cir"><Icon name="play" /></span>
        {running ? <span className="tab-time"><Elapsed start={S.active.start} /></span>
          : <span>{S.active ? (cur === 'workout' ? t('Workout') : S.active.editingWorkoutId ? t('Edit workout') : t('Resume')) : t('Start')}</span>}
      </button>
      {fresh ? planTab : statsTab}
      {fresh ? statsTab : libraryTab}
    </nav>
  )
}
