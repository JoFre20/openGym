import { useEffect, useMemo, useState } from 'react'
import { socialError, socialWorkout } from '../lib/api.js'
import { fmtDate, fmtDur, fmtVol, setsWorkCount } from '../lib/format.js'
import { doneUnits } from '../lib/history.js'
import { t } from '../lib/i18n.js'
import { isOn } from '../lib/modules.js'
import { loadOf } from '../lib/muscles.js'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { shareWorkoutSheet } from '../sheets.jsx'
import BodyMap from './BodyMap.jsx'
import Icon from './Icon.jsx'
import WorkoutMediaSection from './WorkoutMedia.jsx'
import { Button } from './ui.jsx'
import './ActivityWorkoutSheet.css'

const setsOf = detail => (detail?.entries || []).reduce(
  (n, entry) => n + (entry.sets || []).reduce((m, set) => m + doneUnits(set), 0), 0,
)

export function ActivityWorkoutSheet({ item, detail: given = null, localWorkout = null, close }) {
  const S = useStore(s => s.S)
  const [detail, setDetail] = useState(given)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(!given)
  const own = !!item.owner?.me

  useEffect(() => {
    if (given) {
      setDetail(given)
      setError(null)
      setLoading(false)
      return undefined
    }
    let alive = true
    setLoading(true)
    socialWorkout(item.id)
      .then(answer => { if (alive) setDetail(answer?.workout || null) })
      .catch(e => { if (alive) setError(e) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [given, item.id])

  const sets = setsOf(detail)
  const load = useMemo(() => {
    if (!detail) return {}
    return loadOf((detail.entries || []).map(entry => ({
      id: entry.id,
      ex: entry.exercise,
      sets: (entry.sets || []).reduce((n, set) => n + doneUnits(set), 0),
    })))
  }, [detail])

  if (loading) return <><div className="fin-x"><button type="button" className="iconbtn" aria-label={t('Close')} onClick={close}><Icon name="xmark" /></button></div><div className="empty">{t('Loading…')}</div></>
  if (error || !detail) return <>
    <div className="fin-x"><button type="button" className="iconbtn" aria-label={t('Close')} onClick={close}><Icon name="xmark" /></button></div>
    <div className="card social-error-card" role="alert">
      <div className="small">{error ? socialError(error) : t('No sets in this workout.')}</div>
      <Button size="sm" icon="reset" onClick={() => { setError(null); setLoading(true); socialWorkout(item.id).then(a => setDetail(a?.workout || null)).catch(setError).finally(() => setLoading(false)) }}>{t('Try again')}</Button>
    </div>
  </>

  return <div className="act-workout-sheet">
    <div className="fin-x"><button type="button" className="iconbtn" aria-label={t('Close')} onClick={close}><Icon name="xmark" /></button></div>
    <div className="act-workout-hero">
      <h3>{t('Workout complete!')}</h3>
      <div className="act-workout-sub">
        {own ? t('You') : (item.owner?.name || '')}
        {detail.name ? ' · ' + detail.name : ''}
        {detail.date ? ' · ' + fmtDate(detail.date, true, true) : ''}
      </div>
    </div>

    <div className="tiles fin">
      <div className="tile"><div className="l">{t('Duration')}</div><div className="v v-sm">{fmtDur((detail.durationSec || 0) * 1000)}</div></div>
      <div className="tile"><div className="l">{t('Volume')}</div><div className="v v-sm">{fmtVol(detail.volume || 0, detail.unit)}</div></div>
      <div className="tile wide"><div className="l">{t('Sets')}</div><div className="v v-sm">{setsWorkCount(sets, sets)}</div></div>
      <div className="tile narrow act-workout-pr"><div className="l">{t('PRs')}</div><div className="v v-sm">{detail.prCount || '–'}</div></div>
    </div>

    {own && localWorkout && isOn(S, 'motivation') && <div className="fin-actions">
      <Button variant="tinted" icon="share" onClick={() => shareWorkoutSheet(localWorkout)}>{t('Share')}</Button>
    </div>}

    <h4 className="sec">{own ? t('What you trained') : t('What {0} trained', item.owner?.name || '')}</h4>
    <BodyMap load={load} body={S.body} />

    {own && localWorkout && <div className="act-workout-media">
      <WorkoutMediaSection w={localWorkout} hint />
    </div>}
  </div>
}

export const activityWorkoutSheet = (item, { detail = null, localWorkout = null } = {}) =>
  useUI.getState().openSheet(close => <ActivityWorkoutSheet item={item} detail={detail} localWorkout={localWorkout} close={close} />)
