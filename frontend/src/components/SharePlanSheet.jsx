import { useEffect, useMemo, useState } from 'react'
import { initialsOf } from '../lib/social-view.js'
import { socialError, socialMe, socialPlans, sharePlanWithFriends, removeSharedPlan } from '../lib/api.js'
import { buildPlanBundle } from '../lib/plan-share.js'
import { exCount, fmtDate, isoOf, routineCount } from '../lib/format.js'
import { t, tn } from '../lib/i18n.js'
import { nav } from '../lib/nav.js'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { confirmSheet } from '../sheets.jsx'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'
// The sheet borrows the avatar, empty-card and request-row styles the Friends screen uses.
import '../views/Social.css'

/**
 * Pick one or more friends and send them the current plan. The plan travels as the same
 * self-contained bundle the file export writes, so the other side imports it with the same
 * merge (lib/plan-share.js). This sheet never edits either plan: it only sends the snapshot.
 */
export default function SharePlanSheet({ close }) {
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const [me, setMe] = useState(null)
  const [plans, setPlans] = useState({ received: [], sent: [] })
  const [selected, setSelected] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const bundle = useMemo(() => {
    try { return buildPlanBundle(S, user?.name ? t('{0}’s plan', user.name) : '') }
    catch { return null }
  }, [S, user])

  useEffect(() => {
    let alive = true
    // Friends are what the sheet needs to send anything; the sent list is extra. Keep a failing
    // inbox (an older server, a temporary error) from hiding the people you can share with.
    const plansRequest = socialPlans().catch(() => null)
    socialMe()
      .then(nextMe => { if (alive) setMe(nextMe) })
      .catch(e => { if (alive) setError(socialError(e)) })
      .finally(() => { if (alive) setLoading(false) })
    plansRequest.then(nextPlans => { if (alive && nextPlans) setPlans(nextPlans) })
    return () => { alive = false }
  }, [])

  const friends = me?.friends || []
  const toggle = id => setSelected(current =>
    current.includes(id) ? current.filter(value => value !== id) : [...current, id])

  const send = async () => {
    if (!bundle || !selected.length || busy) return
    setBusy(true)
    setError('')
    try {
      const answer = await sharePlanWithFriends(selected, bundle)
      toast(tn('Plan shared with {0} friend', 'Plan shared with {0} friends', answer?.shared || selected.length))
      close()
    } catch (e) {
      setError(socialError(e))
      setBusy(false)
    }
  }

  const remove = row => confirmSheet({
    title: t('Remove the plan for {0}?', row.to.name),
    message: t('They can no longer open it. Routines they already added stay in their plan.'),
    confirmText: t('Remove'),
    danger: true,
    onConfirm: async () => {
      setBusy(true)
      setError('')
      try {
        await removeSharedPlan(row.id)
        setPlans(current => ({ ...current, sent: current.sent.filter(item => item.id !== row.id) }))
        toast(t('Shared plan removed'))
      } catch (e) {
        setError(socialError(e))
      } finally {
        setBusy(false)
      }
    },
  })

  if (loading) return <div className="empty">{t('Loading…')}</div>

  if (!me) {
    return <>
      <h3>{t('Share your plan')}</h3>
      <div className="muted small" style={{ marginBottom: 14 }}>{error || t('Something went wrong')}</div>
      <Button variant="ghost" className="dim" onClick={close}>{t('Close')}</Button>
    </>
  }

  return <div className="share-plan-sheet">
    <h3 style={{ marginBottom: 4 }}>{t('Share your plan')}</h3>
    <div className="muted small share-plan-intro">
      {t('Your friends choose whether to add it to their own plan.')}
    </div>

    {bundle
      ? <div className="share-plan-summary">
        <div className="share-plan-name">{bundle.name || t('Weekly Training Plan')}</div>
        <div className="small dim">
          {routineCount(bundle.routines.length)}
          {' · ' + exCount(bundle.routines.reduce((n, routine) => n + (routine.ex?.length || 0), 0))}
        </div>
      </div>
      : <div className="social-error-text" role="alert">{t('Add an exercise to a routine first.')}</div>}

    {error && <div className="social-error-text" role="alert">{error}</div>}

    {friends.length === 0
      ? <div className="card social-empty share-plan-empty">
        <div className="social-empty-ico"><Icon name="people" /></div>
        <div className="social-empty-title">{t('No friends yet')}</div>
        <div className="muted small">{t('Add a friend with their code to start your squad.')}</div>
        <Button variant="primary" icon="people" onClick={() => { close(); nav('/social') }}>{t('Friends')}</Button>
      </div>
      : <>
        <h4 className="sec share-plan-sec">{t('Friends')}</h4>
        <div className="sect-b share-plan-friends">
          {friends.map(friend => {
            const on = selected.includes(friend.id)
            return <button type="button" key={friend.id} className={'lrow tap share-plan-friend' + (on ? ' on' : '')}
              aria-pressed={on} disabled={busy} onClick={() => toggle(friend.id)}>
              <span className="social-avatar small">{initialsOf(friend.name)}</span>
              <span className="lrow-m"><span className="lrow-t">{friend.name}</span></span>
              <span className={'menu-on' + (on ? ' is-on' : '')}><Icon name="check" /></span>
            </button>
          })}
        </div>
        <div className="share-plan-actions">
          <Button variant="primary" icon="share" disabled={!bundle || !selected.length || busy} onClick={send}>
            {busy
              ? t('Sending…')
              : selected.length
                ? tn('Share with {0} friend', 'Share with {0} friends', selected.length)
                : t('Share')}
          </Button>
        </div>
      </>}

    {plans.sent?.length > 0 && <section className="social-requests share-plan-sent">
      <h4 className="sec">{t('Sent')}</h4>
      <div className="sect-b">
        {plans.sent.map(row => <div className="social-request" key={row.id}>
          <div className="social-request-main">
            <b>{row.to.name}</b>
            <span>{row.name || t('Shared plan')}{row.createdAt ? ' · ' + fmtDate(isoOf(new Date(row.createdAt)), true, true) : ''}</span>
          </div>
          <Button size="sm" variant="ghost" className="dim" disabled={busy} onClick={() => remove(row)}>{t('Remove')}</Button>
        </div>)}
      </div>
    </section>}

    <div className="share-plan-note">
      <Icon name="lock" />
      <span>{t('A copy, not a link. Workouts and weigh-ins never travel.')}</span>
    </div>

    <div className="share-plan-cancel">
      <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
    </div>
  </div>
}
