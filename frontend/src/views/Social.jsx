import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import AddFriendSheet from '../components/AddFriendSheet.jsx'
import Avatar from '../components/Avatar.jsx'
import Icon from '../components/Icon.jsx'
import { Button, Row, Section, Segmented, SelectRow, Switch } from '../components/ui.jsx'
import { SeasonDeco } from '../components/Seasonal.jsx'
import Elapsed from '../components/Elapsed.jsx'
import { EXIDX } from '../lib/exercises.js'
import { exCount, fmtDate, fmtDur, fmtNum, fmtVol, isoOf, routineCount, exerciseNameText } from '../lib/format.js'
import { t, tn, dateLocale } from '../lib/i18n.js'
import {
  getSharedPlan, reactToWorkout, removeSharedPlan, respondToFriendRequest, saveSocialSettings,
  socialError, socialFeed, socialLive, socialMe, socialPlans,
} from '../lib/api.js'
import { parsePlan } from '../lib/plan-share.js'
import { activeSeason } from '../lib/seasonal.js'
import { formatFriendCodeInput, friendCodeComplete, ringProgress, socialWeightView } from '../lib/social-view.js'
import { noteSocialPending } from '../lib/social-badge.js'
import { confirmSheet, menuSheet, planImportSheet } from '../sheets.jsx'
import { useUI } from '../store/useUI.js'
import { useStore } from '../store/useStore.js'
import './Social.css'

const REACTIONS = ['🔥', '💪', '👑']
export const SOCIAL_REFRESH_MS = 30000
export const SOCIAL_LIVE_MS = 15000
const RING_R = 22
const RING_C = 2 * Math.PI * RING_R

function SocialHeader({ nav, me, pending, busy, onRefresh, onAdd, crew = false }) {
  const season = useStore(s => activeSeason(s.S))
  const back = crew ? '/social' : '/home'
  return <div className="hdr social-hdr">
    <button className="iconbtn" data-back={back} onClick={() => nav(back)} aria-label={crew ? t('Activity') : t('Home')}><Icon name="chevronLeft" /></button>
    <div style={{ flex: 1, marginInlineStart: 12 }}>
      <h1>{crew ? t('Crew') : t('Friends')}{season && <span className="social-season" aria-hidden="true"><SeasonDeco spot="friends" /></span>}</h1>
      <div className="sub">{t('Your squad this week')}</div>
    </div>
    <div className="hdr-actions">
      <button className="iconbtn" onClick={onRefresh} disabled={busy || !me} aria-label={t('Sync now')} title={t('Sync now')}>
        <Icon name="reset" />
      </button>
      <button className="social-add-btn" onClick={onAdd} disabled={!me} aria-label={t('Add friend')} title={t('Add friend')}>
        <Icon name="plus" />
        <span>{t('Add friend')}</span>
        {pending > 0 && <span className="social-badge">{pending}</span>}
      </button>
    </div>
  </div>
}

function AccountCard({ nav }) {
  return <div className="card social-account">
    <div className="social-empty-ico"><Icon name="people" /></div>
    <h2>{t('Friends need an account on this server')}</h2>
    <p className="muted small">{t('Sign in or create a profile to use friend codes.')}</p>
    <Button variant="primary" onClick={() => nav('/settings/account')}>{t('Account')}</Button>
  </div>
}

function LoadError({ error, retry }) {
  const message = error?.status ? socialError(error) : t('Could not load')
  return <div className="card social-error-card" role="alert">
    <div className="row between">
      <h2 style={{ margin: 0 }}>{t('Couldn’t load your squad')}</h2>
      <Button size="sm" icon="reset" onClick={retry}>{t('Try again')}</Button>
    </div>
    <div className="muted small social-error-copy">{message}</div>
  </div>
}

function liveExerciseName(row) {
  const known = row.exerciseId ? EXIDX[row.exerciseId] : null
  return known ? exerciseNameText(known) : (row.exName || '')
}

function LiveCard({ row }) {
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
    {ex && <div className="social-live-ex">{ex}</div>}
    <div className="social-live-progress"><i style={{ width: pct + '%' }} /></div>
    <div className="social-live-meta">
      <span>{t('{0} sets', done + '/' + total)}</span>
      {left != null && left > 0 && <span>{t('{0} left', fmtDur(Math.max(60000, left * 1000)))}</span>}
      {left === 0 && <span>{t('Finished')}</span>}
      {finish && <span>{t('Done around {0}', finish)}</span>}
    </div>
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

function PrivacyCard({ settings, unit, saving, onSave, hasPush }) {
  const [local, setLocal] = useState(settings)
  useEffect(() => { setLocal(settings) }, [settings])
  const change = patch => {
    if (saving) return
    const next = { ...local, ...patch }
    setLocal(next)
    onSave(next)
  }
  const shareLive = local.shareLive === true
  const notifyFriends = local.notifyFriends === true
  return <>
    <Section title={t('Privacy')}>
      <Row icon="dumbbell" iconTint="var(--green)" title={t('Share workouts')}>
        <Switch aria-label={t('Share workouts')} checked={local.shareWorkouts} disabled={saving}
          onChange={v => change({ shareWorkouts: v })} />
      </Row>
      <Row icon="scale" iconTint="var(--teal)" title={t('Weight')}>
        <Segmented className="seg-inline" value={local.shareWeight} onChange={v => change({ shareWeight: v })}
          options={[
            { value: 'none', label: t('Off') },
            { value: 'delta', label: t('Delta') },
            { value: 'absolute', label: unit },
          ]} />
      </Row>
    </Section>
    <Section title={t('Live training')}>
      <Row icon="dot" iconTint="var(--green)" title={t('Share live workout')}
        subtitle={t('Friends can follow your workout live.')}>
        <Switch aria-label={t('Share live workout')} checked={shareLive} disabled={saving}
          onChange={v => change({ shareLive: v, ...(v ? {} : { notifyFriends: false }) })} />
      </Row>
      <Row icon="bell" iconTint="var(--orange)" title={t('Tell friends when I start')}>
        <Switch aria-label={t('Tell friends when I start')} checked={notifyFriends}
          disabled={saving || !shareLive} onChange={v => change({ notifyFriends: v })} />
      </Row>
      {shareLive && notifyFriends && <SelectRow icon="chat" iconTint="var(--blue)" title={t('Start message tone')}
        value={local.startTone || 'motivational'} onChange={v => change({ startTone: v })}
        options={[
          { value: 'motivational', label: t('Friendly') },
          { value: 'drill', label: t('Drill sergeant') },
          { value: 'mix', label: t('Mix') },
        ]} />}
      <Row icon="bell" iconTint="var(--teal)" title={t('Friend workout alerts')}
        subtitle={local.friendStartAlerts && !hasPush
          ? t('Turn on push notifications in Settings to get these alerts.')
          : t('Get a notification when a friend starts training.')}>
        <Switch aria-label={t('Friend workout alerts')} checked={local.friendStartAlerts === true}
          disabled={saving} onChange={v => change({ friendStartAlerts: v })} />
      </Row>
    </Section>
  </>
}

function EmptySquad({ onAdd }) {
  return <div className="card social-empty">
    <div className="social-empty-ico"><Icon name="people" /></div>
    <div className="social-empty-title">{t('No friends yet')}</div>
    <div className="muted small">{t('Add a friend with their code to start your squad.')}</div>
    <Button variant="primary" icon="plus" onClick={onAdd}>{t('Add friend')}</Button>
  </div>
}

function WeightLine({ weight, unit }) {
  const view = socialWeightView(weight, unit)
  if (!view) return <div className="social-weight social-weight-private">
    <Icon name="lock" /><span>{t('Weight')} · {t('Private')}</span>
  </div>
  const delta = view.delta
  const icon = delta == null ? null : delta > 0 ? 'arrowUp' : delta < 0 ? 'arrowDown' : 'dot'
  return <div className="social-weight">
    {view.current != null && <div className="social-weight-now">{fmtNum(view.current)} <span>{view.unit}</span></div>}
    {delta != null && <div className={'social-weight-delta ' + (view.trend || '')}>
      <Icon name={icon} />
      <span>{fmtNum(Math.abs(delta))} {view.unit}</span>
    </div>}
  </div>
}

function SquadCard({ stat, friendship, unit, onMenu }) {
  const count = stat.workoutsThisWeek
  const progress = ringProgress(count)
  const ringLabel = count == null
    ? t('Workouts') + ' · ' + t('Private')
    : tn('{0} workout', '{0} workouts', count)
  return <div className="social-friend" role="listitem">
    <Avatar name={stat.name} avatar={stat.avatar} size="md" />
    <div className="social-friend-main">
      <div className="social-friend-name">{stat.name}</div>
      {count != null && <div className="social-friend-meta">
        {tn('{0} workout', '{0} workouts', count)}
      </div>}
      <WeightLine weight={stat.weight} unit={unit} />
    </div>
    <div className="social-friend-side">
      {friendship && <button className="iconbtn social-more" aria-label={t('More') + ' ' + stat.name}
        onClick={() => onMenu(stat, friendship)}><Icon name="more" /></button>}
      <div className="social-ring-wrap" role="img" aria-label={ringLabel}>
        <svg className="social-ring" viewBox="0 0 56 56" aria-hidden="true">
          <circle className="social-ring-bg" cx="28" cy="28" r={RING_R} />
          <circle className="social-ring-fg" cx="28" cy="28" r={RING_R}
            strokeDasharray={RING_C} strokeDashoffset={RING_C * (1 - progress)} transform="rotate(-90 28 28)" />
        </svg>
        <span className="social-ring-num">{count == null ? <Icon name="lock" /> : count}</span>
      </div>
    </div>
  </div>
}

function SquadSection({ stats, friends, unit, onMenu, onAdd }) {
  const rows = useMemo(() => {
    const byId = new Map((friends || []).map(f => [f.id, f]))
    return [...(stats || [])]
      .sort((a, b) => (b.workoutsThisWeek ?? -1) - (a.workoutsThisWeek ?? -1) || a.name.localeCompare(b.name))
      .map(stat => ({ stat, friend: byId.get(stat.id) || null }))
  }, [stats, friends])
  if (!rows.length) return <EmptySquad onAdd={onAdd} />
  return <>
    <div className="row between social-section-head">
      <h4 className="sec">{t('Squad')}</h4>
      <span className="small dim">{t('This week')}</span>
    </div>
    <div className="social-strip" role="list">
      {rows.map(({ stat, friend }) => <SquadCard key={stat.id} stat={stat} friendship={friend}
        unit={unit} onMenu={onMenu} />)}
    </div>
  </>
}

function topSetName(set) {
  const known = EXIDX[set.exerciseId]
  return known ? exerciseNameText(known) : (set.name || t('Exercise'))
}

function FeedCard({ item, busy, onReact, avatar }) {
  const duration = item.durationSec >= 60 ? fmtDur(item.durationSec * 1000) : null
  const title = item.name || t('Workout')
  return <div className="card social-feed-card">
    <div className="social-feed-head">
      <Avatar name={item.friend.name} avatar={avatar} size="sm" />
      <div className="social-feed-who">
        <b>{item.friend.name}</b>
        {item.date && <span className="dim small">{fmtDate(item.date, true, true)}</span>}
      </div>
    </div>
    <div className="social-feed-title">{title}</div>
    <div className="social-feed-meta">
      {duration && <span><Icon name="clock" />{duration}</span>}
      <span><Icon name="barbell" />{fmtVol(item.volume, item.unit)}</span>
    </div>
    {item.prCount > 0 && <div className="social-pr"><Icon name="trophy" />{tn('{0} PR', '{0} PRs', item.prCount)}</div>}
    {item.topSets?.length > 0 && <div className="social-top-sets">
      <div className="social-top-title">{t('Top sets')}</div>
      {item.topSets.map((set, i) => <div className="social-top-set" key={set.exerciseId + ':' + i}>
        <span>{topSetName(set)}</span>
        <b>{fmtNum(set.weight)} {item.unit} × {set.reps}</b>
      </div>)}
    </div>}
    <div className="social-reactions" role="group" aria-label={t('Reactions')}>
      {REACTIONS.map(emoji => {
        const reaction = item.reactions?.[emoji] || { count: 0, mine: false }
        return <button type="button" key={emoji} className={'social-reaction' + (reaction.mine ? ' on' : '')}
          aria-pressed={reaction.mine} aria-label={t('React with {0}', emoji)} disabled={busy}
          onClick={() => onReact(item, emoji)}>
          <span className="social-reaction-emoji">{emoji}</span>
          {reaction.count > 0 && <span className="social-reaction-count">{reaction.count}</span>}
        </button>
      })}
    </div>
  </div>
}

function FeedSection({ feed, busyId, onReact, avatarById }) {
  return <section className="social-feed-section">
    <h4 className="sec">{t('Activity')}</h4>
    {feed.length
      ? <div className="social-feed">{feed.map(item => <FeedCard key={item.workoutId} item={item}
        avatar={avatarById.get(item.friend.id)} busy={busyId === item.workoutId} onReact={onReact} />)}</div>
      : <div className="card social-empty social-feed-empty">
        <div className="social-empty-ico"><Icon name="flame" /></div>
        <div className="muted small">{t('When your friends train, their workouts show up here.')}</div>
      </div>}
  </section>
}

function SharedPlanCard({ item, busy, onOpen, onMenu }) {
  const when = item.createdAt ? isoOf(new Date(item.createdAt)) : ''
  return <div className="card social-plan-card">
    <div className="social-feed-head">
      <Avatar name={item.from.name} avatar={item.from.avatar} size="sm" />
      <div className="social-feed-who">
        <b>{item.from.name}</b>
        {when && <span className="dim small">{fmtDate(when, true, true)}</span>}
      </div>
      <button className="iconbtn social-more" aria-label={t('More') + ' ' + item.from.name}
        onClick={() => onMenu(item)}><Icon name="more" /></button>
    </div>
    <div className="social-plan-title">{item.name || t('Shared plan')}</div>
    <div className="social-feed-meta">
      <span><Icon name="barbell" />{routineCount(item.routineCount)}</span>
      <span><Icon name="dumbbell" />{exCount(item.exerciseCount)}</span>
      {item.scheduledDays > 0 && <span><Icon name="calendar" />{tn('{0} day', '{0} days', item.scheduledDays)}</span>}
    </div>
    <Button variant="tinted" icon="download" disabled={busy} onClick={() => onOpen(item)}>
      {busy ? t('Loading…') : t('Open')}
    </Button>
  </div>
}

function SharedPlansSection({ plans, busyId, onOpen, onMenu }) {
  if (!plans.length) return null
  return <section className="social-plans">
    <h4 className="sec">{t('Shared with you')}</h4>
    <div className="social-plan-list">
      {plans.map(item => <SharedPlanCard key={item.id} item={item}
        busy={busyId === item.id} onOpen={onOpen} onMenu={onMenu} />)}
    </div>
  </section>
}

export default function Social({ crew = false }) {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const linkedCode = friendCodeComplete(params.get('friend')) ? formatFriendCodeInput(params.get('friend')) : ''
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const [me, setMe] = useState(null)
  const [data, setData] = useState(null)
  const [live, setLive] = useState([])
  const [plans, setPlans] = useState({ received: [], sent: [] })
  const [loading, setLoading] = useState(!!user)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [reactionBusy, setReactionBusy] = useState(null)
  const [planBusy, setPlanBusy] = useState(null)
  const alive = useRef(true)
  const lastLoaded = useRef(0)
  const liveBusy = useRef(false)
  const userId = user?.id || ''

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!userId) {
      liveBusy.current = false
      setMe(null); setData(null); setLive([]); setPlans({ received: [], sent: [] }); setError(null); setLoading(false)
      return
    }
    if (!quiet) setLoading(true)
    setError(null)
    // The plan inbox is an addition, not the reason to open the Friends tab. Start it beside the
    // squad, but let its failure leave the squad and feed alone: a server from before plan sharing
    // (or one whose route is temporarily unavailable) must not turn the whole screen into an error.
    const planRequest = socialPlans().catch(() => null)
    try {
      const [nextMe, nextData] = await Promise.all([socialMe(), socialFeed()])
      if (!alive.current) return
      setMe(nextMe)
      setData(nextData)
      lastLoaded.current = Date.now()
      noteSocialPending(userId, nextMe)
    } catch (e) {
      if (alive.current) setError(e)
    } finally {
      if (alive.current) setLoading(false)
    }
    const nextPlans = await planRequest
    if (alive.current && nextPlans) setPlans(nextPlans)
  }, [userId])

  const refreshLive = useCallback(async () => {
    if (!userId || liveBusy.current || document.visibilityState === 'hidden') return
    liveBusy.current = true
    try {
      const next = await socialLive()
      if (alive.current) setLive(Array.isArray(next?.live) ? next.live : [])
    } catch { /* the live strip is additive: a failure leaves the squad and feed alone */ }
    finally { liveBusy.current = false }
  }, [userId])

  useEffect(() => {
    alive.current = true
    load()
    refreshLive()
    return () => { alive.current = false }
  }, [load, refreshLive])

  useEffect(() => {
    if (!userId) { setLive([]); return undefined }
    const iv = setInterval(refreshLive, SOCIAL_LIVE_MS)
    return () => clearInterval(iv)
  }, [userId, refreshLive])

  const refreshFeed = useCallback(async () => {
    if (!userId) return
    try {
      const next = await socialFeed()
      if (alive.current) {
        setData(next)
        setError(null)
        lastLoaded.current = Date.now()
      }
    } catch (e) {
      if (alive.current) setError(e)
    }
  }, [userId])

  const refreshIfStale = useCallback(() => {
    if (!userId || document.visibilityState === 'hidden') return
    if (saving || reactionBusy) return
    if (Date.now() - lastLoaded.current < SOCIAL_REFRESH_MS) return
    load({ quiet: true })
  }, [userId, saving, reactionBusy, load])

  useEffect(() => {
    const onFocus = () => { refreshIfStale(); refreshLive() }
    document.addEventListener('visibilitychange', onFocus)
    window.addEventListener('focus', onFocus)
    return () => {
      document.removeEventListener('visibilitychange', onFocus)
      window.removeEventListener('focus', onFocus)
    }
  }, [refreshIfStale, refreshLive])

  const openAdd = useCallback((initialCode = '') => {
    if (!me) return
    useUI.getState().openSheet(close => <AddFriendSheet me={me} initialCode={initialCode} close={close}
      onChanged={next => {
        if (!alive.current) return
        setMe(next)
        noteSocialPending(userId, next)
      }} onFriendChanged={refreshFeed} />)
  }, [me, userId, refreshFeed])

  // A friend link (#/social?friend=CODE) opens the sheet with the code filled in. The query is
  // dropped at once so closing the sheet or reloading does not open it again; the sheet itself
  // lives outside the route and stays open while the pathname stays /social.
  const openedLink = useRef('')
  useEffect(() => {
    if (!linkedCode) { openedLink.current = ''; return }
    if (!me || openedLink.current === linkedCode) return
    openedLink.current = linkedCode
    // Clean the address before the sheet pushes its own history entry, so closing the sheet
    // cannot land back on the link and open it a second time.
    nav('/social', { replace: true })
    openAdd(linkedCode)
  }, [linkedCode, me, openAdd, nav])

  const saveSettings = async next => {
    if (!me || saving) return
    const previous = me.settings
    setSaving(true)
    setMe(current => current ? { ...current, settings: next } : current)
    try {
      const answer = await saveSocialSettings(next)
      if (alive.current) setMe(current => current ? { ...current, settings: answer.settings } : current)
    } catch (e) {
      if (alive.current) setMe(current => current ? { ...current, settings: previous } : current)
      toast(socialError(e))
    } finally {
      if (alive.current) setSaving(false)
    }
  }

  const react = async (item, emoji) => {
    if (reactionBusy) return
    setReactionBusy(item.workoutId)
    try {
      const answer = await reactToWorkout(item.workoutId, emoji)
      if (!alive.current) return
      setData(current => current ? {
        ...current,
        feed: (current.feed || []).map(row => row.workoutId === item.workoutId
          ? { ...row, reactions: answer.reactions }
          : row),
      } : current)
    } catch (e) {
      toast(socialError(e))
      if (e?.data?.code === 'not-shared' || e?.data?.code === 'workout-not-found') refreshFeed()
    } finally {
      if (alive.current) setReactionBusy(null)
    }
  }

  const removeFriend = async friend => {
    try {
      await respondToFriendRequest(friend.friendshipId, 'remove')
      if (alive.current) setMe(current => current ? {
        ...current,
        friends: (current.friends || []).filter(row => row.id !== friend.id),
      } : current)
      toast(t('Friend removed'))
    } catch (e) {
      toast(socialError(e))
      return
    }
    try {
      await Promise.all([
        refreshFeed(),
        refreshLive(),
        socialPlans().then(next => { if (alive.current) setPlans(next || { received: [], sent: [] }) }),
      ])
    } catch { /* keep the removal even if the feed is briefly unavailable */ }
  }

  const refreshPlans = useCallback(async () => {
    if (!userId) return
    try {
      const next = await socialPlans()
      if (alive.current) setPlans(next || { received: [], sent: [] })
    } catch (e) {
      if (alive.current) setError(e)
    }
  }, [userId])

  // Opening only fetches the snapshot, never merges it. The existing plan import sheet shows the
  // summary, the schedule switch and the dropped-exercise warning; Add to my plan does the merge.
  const openSharedPlan = async item => {
    if (planBusy) return
    setPlanBusy(item.id)
    try {
      const { plan } = await getSharedPlan(item.id)
      const bundle = parsePlan(plan, S.unit || 'kg')
      planImportSheet(bundle, { onApplied: () => removeSharedPlan(item.id).catch(() => {}) })
    } catch (e) {
      toast(e?.code === 'not-plan' ? t('Couldn’t read that plan.') : socialError(e))
      if (e?.data?.code === 'share-not-found') refreshPlans()
    } finally {
      if (alive.current) setPlanBusy(null)
    }
  }

  const removePlanShare = async item => {
    if (planBusy) return
    setPlanBusy(item.id)
    try {
      await removeSharedPlan(item.id)
      if (!alive.current) return
      setPlans(current => ({ ...current, received: current.received.filter(row => row.id !== item.id) }))
      const nextMe = me ? { ...me, planShares: Math.max(0, (me.planShares || 0) - 1) } : me
      setMe(nextMe)
      if (nextMe) noteSocialPending(userId, nextMe)
      toast(t('Shared plan removed'))
    } catch (e) {
      toast(socialError(e))
      if (e?.data?.code === 'share-not-found') refreshPlans()
    } finally {
      if (alive.current) setPlanBusy(null)
    }
  }

  const openSharedPlanMenu = item => {
    menuSheet({
      title: item.name || t('Shared plan'),
      items: [{
        icon: 'trash', label: t('Remove shared plan'), danger: true,
        onClick: () => confirmSheet({
          title: t('Remove this shared plan?'),
          message: t('It is removed for both of you. Routines already added stay in your plan.'),
          confirmText: t('Remove'), danger: true,
          onConfirm: () => removePlanShare(item),
        }),
      }],
    })
  }

  const openFriendMenu = (stat, friend) => {
    menuSheet({
      title: stat.name,
      items: [{
        icon: 'trash', label: t('Remove friend'), danger: true,
        onClick: () => confirmSheet({
          title: t('Remove {0}?', stat.name),
          message: t('They leave your squad, and the reactions between you are removed.'),
          confirmText: t('Remove'), danger: true,
          onConfirm: () => removeFriend(friend),
        }),
      }],
    })
  }

  const squadStats = data?.squadStats || []
  const feed = data?.feed || []
  // A feed carries the same friend on every workout, so the picture travels once in squadStats
  // and the cards look it up by id instead of repeating the data URL up to thirty times.
  const avatarById = new Map(squadStats.filter(row => row.avatar).map(row => [row.id, row.avatar]))
  const pending = (me?.pending || []).filter(row => row.direction === 'incoming').length
  const ready = !!me && !!data

  return <div className="narrow social-page">
    <SocialHeader nav={nav} me={me} pending={pending} busy={loading} onRefresh={() => load()} onAdd={() => openAdd()} crew={crew} />
    {!user
      ? <AccountCard nav={nav} />
      : loading && !ready
        ? <div className="empty">{t('Loading…')}</div>
        : !ready
          ? <LoadError error={error} retry={() => load()} />
          : <>
            {error && <div className="card social-error-card" role="alert">
              <div className="row between">
                <span className="small">{t('Couldn’t load your squad')}</span>
                <Button size="sm" icon="reset" onClick={() => load({ quiet: true })}>{t('Try again')}</Button>
              </div>
            </div>}
            {!crew && <LiveSection rows={live} />}
            <PrivacyCard settings={me.settings} unit={S.unit === 'lb' ? 'lb' : 'kg'}
              saving={saving} onSave={saveSettings} hasPush={!!me.hasPush} />
            <SquadSection stats={squadStats} friends={me.friends} unit={S.unit === 'lb' ? 'lb' : 'kg'}
              onMenu={openFriendMenu} onAdd={() => openAdd()} />
            <SharedPlansSection plans={plans.received} busyId={planBusy}
              onOpen={openSharedPlan} onMenu={openSharedPlanMenu} />
            {!crew && squadStats.length > 0 && <FeedSection feed={feed} busyId={reactionBusy} onReact={react}
              avatarById={avatarById} />}
          </>}
  </div>
}
