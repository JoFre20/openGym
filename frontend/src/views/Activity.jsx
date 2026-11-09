import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import AddFriendSheet from '../components/AddFriendSheet.jsx'
import Avatar from '../components/Avatar.jsx'
import Elapsed from '../components/Elapsed.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { EXIDX } from '../lib/exercises.js'
import { fmtDate, fmtDur, fmtNum, fmtVol, exerciseNameText } from '../lib/format.js'
import { t, tn, dateLocale } from '../lib/i18n.js'
import { challengeTitle, monthLabel } from '../lib/challenge-copy.js'
import { convertBodyWeight } from '../lib/units.js'
import { getSharedPlan, reactToWorkout, removeSharedPlan, socialError, socialFeed, socialMe, socialPlans } from '../lib/api.js'
import { parsePlan } from '../lib/plan-share.js'
import { activityCounts, filterActivity, mergeActivity, ownActivity, topSetName } from '../lib/activity.js'
import { getLiveRows, refreshLiveBadge, subscribeLive } from '../lib/live-badge.js'
import { formatFriendCodeInput, friendCodeComplete } from '../lib/social-view.js'
import { noteSocialPending } from '../lib/social-badge.js'
import { planImportSheet } from '../sheets.jsx'
import { useUI } from '../store/useUI.js'
import { useStore } from '../store/useStore.js'
import './Social.css'
import './Activity.css'

const REACTIONS = ['🔥', '💪', '👑']
export const ACTIVITY_REFRESH_MS = 30000

const FILTERS = [
  ['all', 'All'],
  ['friends', 'Friends'],
  ['me', 'Me'],
  ['goals', 'Goals'],
]

function liveExerciseName(row) {
  const known = row.exerciseId ? EXIDX[row.exerciseId] : null
  return known ? exerciseNameText(known) : (row.exName || '')
}

function LiveCard({ row }) {
  const limited = row.limited === true
  const done = Math.max(0, Number(row.setsDone) || 0)
  const total = Math.max(0, Number(row.setsTotal) || 0)
  const pct = total ? Math.min(100, done / total * 100) : 0
  const left = Number.isFinite(row.leftSec) ? row.leftSec : null
  const finish = Number.isFinite(row.etaAt) && row.etaAt > 0
    ? new Date(row.etaAt).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' })
    : ''
  const ex = liveExerciseName(row)
    || (row.exIdx > 0 && row.exTotal > 0 ? t('Exercise {0} of {1}', row.exIdx, row.exTotal) : '')
  return <div className="social-live-card" role="listitem">
    <div className="social-live-head">
      <Avatar name={row.friend.name} avatar={row.friend.avatar} size="sm" />
      <div className="social-live-who">
        <b>{row.friend.name}</b>
        <span><Elapsed start={row.startedAt} /></span>
      </div>
      <span className="social-live-pill"><Icon name="dot" />{t('Live')}</span>
    </div>
    <div className="social-live-workout">{row.name || t('Workout')}</div>
    {limited
      ? <div className="social-live-limited"><Icon name="lock" />{t('Only close friends see the details')}</div>
      : <>
        {ex && <div className="social-live-ex">{ex}</div>}
        <div className="social-live-progress"><i style={{ width: pct + '%' }} /></div>
        <div className="social-live-meta">
          <span>{t('{0} sets', done + '/' + total)}</span>
          {left != null && left > 0 && <span>{t('{0} left', fmtDur(Math.max(60000, left * 1000)))}</span>}
          {left === 0 && <span>{t('Finished')}</span>}
          {finish && <span>{t('Done around {0}', finish)}</span>}
        </div>
      </>}
  </div>
}

function LiveSection({ rows }) {
  if (!rows.length) return null
  return <section className="social-live">
    <div className="row between social-section-head">
      <h4 className="sec">{t('Live now')}</h4>
      <span className="social-live-count"><i />{rows.length}</span>
    </div>
    <div className="social-live-list" role="list">
      {rows.map(row => <LiveCard key={row.friend.id} row={row} />)}
    </div>
  </section>
}

function Reactions({ item, reactions, onReact, busy }) {
  const mine = !!item.owner?.me
  if (mine && REACTIONS.every(emoji => !(Number(reactions?.[emoji]?.count) > 0))) return null
  return <div className="social-reactions" role="group" aria-label={t('Reactions')}>
    {REACTIONS.map(emoji => {
      const reaction = reactions?.[emoji] || { count: 0, mine: false }
      if (mine) {
        return reaction.count > 0
          ? <span key={emoji} className={'social-reaction' + (reaction.mine ? ' on' : '')}>
              <span className="social-reaction-emoji">{emoji}</span><span className="social-reaction-count">{reaction.count}</span>
            </span>
          : null
      }
      return <button type="button" key={emoji} className={'social-reaction' + (reaction.mine ? ' on' : '')}
        aria-pressed={reaction.mine} aria-label={t('React with {0}', emoji)} disabled={busy}
        onClick={() => onReact(item, emoji)}>
        <span className="social-reaction-emoji">{emoji}</span>
        {reaction.count > 0 && <span className="social-reaction-count">{reaction.count}</span>}
      </button>
    })}
  </div>
}

function GoalCard({ item, avatar, reactions, onReact, busy }) {
  const profileUnit = useStore(s => s.S.unit) === 'lb' ? 'lb' : 'kg'
  const data = item.milestone?.data || {}
  const weight = item.milestone?.kind === 'weight_goal'
  const sourceUnit = data.unit === 'lb' ? 'lb' : 'kg'
  const unit = profileUnit
  const inUnit = value => (value == null ? null : convertBodyWeight(value, sourceUnit, unit))
  let title = t('Goal')
  let detail = ''
  if (weight) {
    title = t('Weight goal')
    if (data.mode === 'delta') {
      const delta = inUnit(data.delta)
      detail = delta != null ? `${delta > 0 ? '+' : ''}${fmtNum(delta)} ${unit}` : ''
    } else {
      const target = inUnit(data.targetW)
      const current = inUnit(data.current)
      const delta = inUnit(data.delta)
      detail = [
        target != null && target > 0 ? t('Goal') + ' ' + fmtNum(target) + ' ' + unit : '',
        current != null && current > 0 ? fmtNum(current) + ' ' + unit : '',
        delta != null ? (delta > 0 ? '+' : '') + fmtNum(delta) + ' ' + unit : '',
      ].filter(Boolean).join(' · ')
    }
  } else {
    title = challengeTitle({
      id: data.challengeId,
      n: data.n,
      u: data.u,
    }, unit)
    detail = data.month ? monthLabel(data.month) : ''
  }
  return <div className="card social-feed-card act-goal-card">
    <div className="social-feed-head">
      <Avatar name={item.owner.name} avatar={avatar || item.owner.avatar} size="sm" />
      <div className="social-feed-who">
        <b>{item.owner.me ? t('You') : item.owner.name}</b>
        {item.date && <span className="dim small">{fmtDate(item.date, true, true)}</span>}
      </div>
      <span className="act-goal-pill"><Icon name="trophy" />{t('Goal reached')}</span>
    </div>
    <div className="act-goal-title">{title}</div>
    {detail && <div className="act-goal-detail">{detail}</div>}
    <Reactions item={item} reactions={reactions} onReact={onReact} busy={busy} />
  </div>
}

function WorkoutCard({ item, avatar, reactions, onReact, busy }) {
  const w = item.workout || {}
  const duration = w.durationSec >= 60 ? fmtDur(w.durationSec * 1000) : null
  return <div className="card social-feed-card">
    <div className="social-feed-head">
      <Avatar name={item.owner.name} avatar={avatar || item.owner.avatar} size="sm" />
      <div className="social-feed-who">
        <b>{item.owner.me ? t('You') : item.owner.name}</b>
        {item.date && <span className="dim small">{fmtDate(item.date, true, true)}</span>}
      </div>
    </div>
    <div className="social-feed-title">{w.name || t('Workout')}</div>
    <div className="social-feed-meta">
      {duration && <span><Icon name="clock" />{duration}</span>}
      {w.volume > 0 && <span><Icon name="barbell" />{fmtVol(w.volume, w.unit || 'kg')}</span>}
    </div>
    {w.prCount > 0 && <div className="social-pr"><Icon name="trophy" />{tn('{0} PR', '{0} PRs', w.prCount)}</div>}
    {w.topSets?.length > 0 && <div className="social-top-sets">
      <div className="social-top-title">{t('Top sets')}</div>
      {w.topSets.map((set, i) => <div className="social-top-set" key={set.exerciseId + ':' + i}>
        <span>{topSetName(set)}</span>
        <b>{fmtNum(set.weight)} {w.unit || 'kg'} × {set.reps}</b>
      </div>)}
    </div>}
    <Reactions item={item} reactions={reactions} onReact={onReact} busy={busy} />
  </div>
}

function SharedPlanCard({ item, busy, onOpen }) {
  return <div className="card act-plan-card">
    <div className="social-feed-head">
      <Avatar name={item.from.name} avatar={item.from.avatar} size="sm" />
      <div className="social-feed-who">
        <b>{item.from.name}</b>
        <span className="dim small">{t('Shared with you')}</span>
      </div>
    </div>
    <div className="act-plan-title">{item.name || t('Shared plan')}</div>
    <div className="social-feed-meta">
      <span><Icon name="barbell" />{tn('{0} routine', '{0} routines', item.routineCount)}</span>
      <span><Icon name="dumbbell" />{tn('{0} exercise', '{0} exercises', item.exerciseCount)}</span>
      {item.scheduledDays > 0 && <span><Icon name="calendar" />{tn('{0} day', '{0} days', item.scheduledDays)}</span>}
    </div>
    <Button variant="tinted" icon="download" disabled={busy} onClick={() => onOpen(item)}>
      {busy ? t('Loading…') : t('Open')}
    </Button>
  </div>
}

export default function Activity() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const userId = user?.id || ''
  // The tab bar owns the polling; this screen only reads the shared rows and can force a refresh.
  const live = useSyncExternalStore(subscribeLive, () => getLiveRows(userId), () => getLiveRows(userId))
  const linkedCode = friendCodeComplete(params.get('friend')) ? formatFriendCodeInput(params.get('friend')) : ''
  const [me, setMe] = useState(null)
  const [data, setData] = useState(null)
  const [plans, setPlans] = useState([])
  const [loading, setLoading] = useState(!!user)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('all')
  const [busy, setBusy] = useState(null)
  const [planBusy, setPlanBusy] = useState(null)
  const [reactionOverrides, setReactionOverrides] = useState({})
  const alive = useRef(true)
  const lastLoaded = useRef(0)
  const openedLink = useRef('')

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!userId) {
      setMe(null); setData(null); setPlans([]); setError(null); setLoading(false)
      return
    }
    if (!quiet) setLoading(true)
    setError(null)
    const planRequest = socialPlans().catch(() => null)
    try {
      const [nextMe, nextData] = await Promise.all([socialMe(), socialFeed()])
      if (!alive.current) return
      setMe(nextMe)
      setData(nextData)
      setReactionOverrides({})
      lastLoaded.current = Date.now()
      noteSocialPending(userId, nextMe)
    } catch (e) {
      if (alive.current) setError(e)
    } finally {
      if (alive.current) setLoading(false)
    }
    const nextPlans = await planRequest
    if (alive.current && nextPlans) setPlans(nextPlans.received || [])
  }, [userId])

  useEffect(() => {
    alive.current = true
    load()
    if (userId) refreshLiveBadge(userId)
    return () => { alive.current = false }
  }, [load, userId])

  const refreshIfStale = useCallback(() => {
    if (!userId || document.visibilityState === 'hidden') return
    if (Date.now() - lastLoaded.current < ACTIVITY_REFRESH_MS) return
    load({ quiet: true })
  }, [userId, load])
  useEffect(() => {
    const onFocus = () => {
      refreshIfStale()
      if (userId) refreshLiveBadge(userId)
    }
    document.addEventListener('visibilitychange', onFocus)
    window.addEventListener('focus', onFocus)
    return () => {
      document.removeEventListener('visibilitychange', onFocus)
      window.removeEventListener('focus', onFocus)
    }
  }, [refreshIfStale, userId])

  const openAdd = useCallback((initialCode = '') => {
    if (!me) return
    useUI.getState().openSheet(close => <AddFriendSheet me={me} initialCode={initialCode} close={close}
      onChanged={next => { if (!alive.current) return; setMe(next); noteSocialPending(userId, next) }}
      onFriendChanged={() => load({ quiet: true })} />)
  }, [me, userId, load])

  useEffect(() => {
    if (!linkedCode) { openedLink.current = ''; return }
    if (!me || openedLink.current === linkedCode) return
    openedLink.current = linkedCode
    navigate('/social', { replace: true })
    openAdd(linkedCode)
  }, [linkedCode, me, openAdd, navigate])

  const react = async (item, emoji) => {
    if (busy || item.owner?.me) return
    setBusy(item.id)
    try {
      const answer = await reactToWorkout(item.id, emoji)
      if (alive.current) setReactionOverrides(current => ({ ...current, [item.id]: answer.reactions }))
    } catch (e) {
      toast(socialError(e))
      if (e?.data?.code === 'not-shared' || e?.data?.code === 'workout-not-found' || e?.data?.code === 'milestone-not-found') {
        load({ quiet: true })
      }
    } finally {
      if (alive.current) setBusy(null)
    }
  }

  const openPlan = async item => {
    if (planBusy) return
    setPlanBusy(item.id)
    try {
      const { plan } = await getSharedPlan(item.id)
      const bundle = parsePlan(plan, S.unit || 'kg')
      planImportSheet(bundle, {
        onApplied: () => {
          removeSharedPlan(item.id).catch(() => {})
          setPlans(current => current.filter(row => row.id !== item.id))
        },
      })
    } catch (e) {
      toast(e?.code === 'not-plan' ? t('Couldn’t read that plan.') : socialError(e))
      if (e?.data?.code === 'share-not-found') load({ quiet: true })
    } finally {
      if (alive.current) setPlanBusy(null)
    }
  }

  // The local copy first, the server's rows last: the merge keeps the server's version of an
  // item that has reactions, and a workout logged a moment ago (not pushed yet) still shows.
  const localOwn = useMemo(() => ownActivity(S, user), [S, user])
  const own = useMemo(() => (data?.own ? [...localOwn, ...data.own] : localOwn), [localOwn, data])
  const items = useMemo(() => mergeActivity(own, data?.feed || [], data?.milestones || [], user), [own, data, user])
  // Profile pictures travel once per person in squadStats/me, never on every card.
  const avatars = useMemo(() => {
    const map = new Map((data?.squadStats || []).filter(row => row.avatar).map(row => [String(row.id), row.avatar]))
    if (me?.avatar) map.set(String(userId), me.avatar)
    return map
  }, [data, me, userId])
  const counts = activityCounts(items)
  const shown = filterActivity(items, filter)
  const incoming = (me?.pending || []).filter(row => row.direction === 'incoming')
  const pending = incoming.length + (Number(me?.planShares) || 0)
  const ready = !loading
  const filterLabel = key => {
    if (key === 'all') return t('All')
    if (key === 'friends') return t('Friends')
    if (key === 'me') return t('Me')
    return t('Goals')
  }

  return <div className="narrow act-page">
    <div className="hdr act-hdr">
      <div>
        <h1>{t('Activity')}</h1>
        <div className="sub">{t('Your squad this week')}</div>
      </div>
      <div className="hdr-actions">
        <button type="button" className="hdr-pill" onClick={() => navigate('/crew')} aria-label={t('Crew')} title={t('Crew')}>
          <Icon name="people" /><span>{t('Crew')}</span>
          {pending > 0 && <span className="icon-badge">{pending > 9 ? '9+' : pending}</span>}
        </button>
        <button className="iconbtn" disabled={!me} onClick={() => openAdd()} aria-label={t('Add friend')} title={t('Add friend')}><Icon name="plus" /></button>
        <button className="iconbtn" disabled={!userId || loading} onClick={() => { load(); if (userId) refreshLiveBadge(userId, { force: true }) }} aria-label={t('Sync now')} title={t('Sync now')}><Icon name="reset" /></button>
      </div>
    </div>

    {!userId && <div className="card act-account">
      <div className="social-empty-ico"><Icon name="people" /></div>
      <h2>{t('Friends need an account on this server')}</h2>
      <p className="muted small">{t('Sign in or create a profile to use friend codes.')}</p>
      <Button variant="primary" onClick={() => navigate('/settings/account')}>{t('Account')}</Button>
    </div>}

    {error && <div className="card social-error-card" role="alert">
      <div className="row between">
        <span className="small">{t('Couldn’t load your squad')}</span>
        <Button size="sm" icon="reset" onClick={() => load({ quiet: true })}>{t('Try again')}</Button>
      </div>
    </div>}

    {!ready && <div className="empty">{t('Loading…')}</div>}

    {ready && <>
      {/* Live stays above the filters: switching to Goals or Me must not hide who is training now. */}
      <LiveSection rows={live} />

      <div className="chips act-filters" role="tablist" aria-label={t('Activity')}>
        {FILTERS.map(([key]) => <button type="button" key={key} role="tab" aria-selected={filter === key}
          className={'chip act-filter' + (filter === key ? ' on' : '')} onClick={() => setFilter(key)}>
          {filterLabel(key)}{counts[key] > 0 && <span className="act-count">{counts[key]}</span>}
        </button>)}
      </div>

      {(plans.length > 0 || incoming.length > 0) && <section className="act-for-you">
        <h4 className="sec">{t('For you')}</h4>
        {incoming.length > 0 && <div className="card act-request-card">
          <span className="lrow-i" style={{ '--tint': 'var(--acc)' }}><Icon name="people" /></span>
          <div className="act-request-copy">
            <b>{t('Requests')}</b>
            <span>{tn('{0} friend request', '{0} friend requests', incoming.length)}</span>
          </div>
          <Button size="sm" variant="tinted" onClick={() => navigate('/crew')}>{t('Open')}</Button>
        </div>}
        {plans.map(item => <SharedPlanCard key={item.id} item={item} busy={planBusy === item.id} onOpen={openPlan} />)}
      </section>}

      <section className="social-feed-section">
        {shown.length
          ? <div className="social-feed">
            {shown.map(item => item.kind === 'milestone'
              ? <GoalCard key={item.id} item={item} avatar={avatars.get(item.owner.id)} reactions={reactionOverrides[item.id] || item.reactions} onReact={react} busy={busy === item.id} />
              : <WorkoutCard key={item.id} item={item} avatar={avatars.get(item.owner.id)} reactions={reactionOverrides[item.id] || item.reactions} onReact={react} busy={busy === item.id} />)}
          </div>
          : <div className="card social-empty social-feed-empty">
            <div className="social-empty-ico"><Icon name={filter === 'goals' ? 'target' : 'flame'} /></div>
            <div className="social-empty-title">{filter === 'goals' ? t('Goals') : t('No activity yet')}</div>
            <div className="muted small">{filter === 'goals'
              ? t('Reached goals show up here.')
              : t('Your workouts and reached goals show up here.')}</div>
          </div>}
      </section>
    </>}
  </div>
}
