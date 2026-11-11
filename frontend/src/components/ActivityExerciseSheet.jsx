import { useEffect, useMemo, useState } from 'react'
import { socialError, socialWorkout } from '../lib/api.js'
import { EXIDX, exOr } from '../lib/exercises.js'
import { exerciseNameText, fmtDate, fmtDur, fmtNum, fmtVol } from '../lib/format.js'
import { completedRepsOf, doneUnits, workoutVolume } from '../lib/history.js'
import { t } from '../lib/i18n.js'
import { inMuscleOrder, loadOf, MUSCLE_NAME, musclesOf } from '../lib/muscles.js'
import { useUI } from '../store/useUI.js'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'
import './ActivityExerciseSheet.css'

const num = v => Number.isFinite(Number(v)) ? Number(v) : 0

const setWeight = set => {
  if (!set) return 0
  if (set.sides) return Math.max(setWeight(set.sides.L), setWeight(set.sides.R))
  return num(set.w)
}

const setText = (set, unit) => {
  if (num(set?.sec) > 0) return fmtDur(num(set.sec) * 1000)
  if (num(set?.min) > 0) {
    const speed = num(set.speed) > 0 ? ' · ' + fmtNum(set.speed) + ' km/h' : ''
    return fmtNum(set.min) + ' min' + speed
  }
  const weight = setWeight(set)
  const reps = completedRepsOf(set)
  if (!(weight > 0) && reps > 0) return `${reps} ${t('reps')}`
  return `${fmtNum(weight)} ${unit} × ${reps}`
}

const muscleLabel = slug => t(MUSCLE_NAME[slug] || slug)

const exerciseOf = entry => entry?.exercise || EXIDX[entry?.id] || exOr(entry?.id || '')

const exerciseName = entry => {
  if (!entry) return t('Exercise')
  const name = entry.name || exerciseNameText(exerciseOf(entry))
  return name || t('Exercise')
}

export function ActivityExerciseSheet({ item, exerciseId, close, localDetail = null }) {
  const [detail, setDetail] = useState(localDetail)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(!localDetail)

  useEffect(() => {
    if (localDetail) {
      setDetail(localDetail)
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
  }, [item.id, localDetail])

  const entry = useMemo(
    () => (detail?.entries || []).find(row => String(row.id) === String(exerciseId)) || null,
    [detail, exerciseId],
  )
  const unit = detail?.unit === 'lb' ? 'lb' : (item.workout?.unit === 'lb' ? 'lb' : 'kg')
  const sets = entry?.sets || []
  const setCount = sets.reduce((n, set) => n + doneUnits(set), 0)
  const reps = sets.reduce((n, set) => n + completedRepsOf(set), 0)
  const volume = entry ? workoutVolume({ entries: [entry] }) : 0
  const top = sets.reduce((best, set) => {
    const weight = setWeight(set), rowReps = completedRepsOf(set)
    if (!(weight > 0 || rowReps > 0 || num(set.sec) > 0 || num(set.min) > 0)) return best
    if (!best || weight > best.weight || (weight === best.weight && rowReps > best.reps)) return { set, weight, reps: rowReps }
    return best
  }, null)
  const entryMuscles = entry ? inMuscleOrder(Object.keys(musclesOf(exerciseOf(entry)))) : []
  const workoutLoad = useMemo(() => {
    if (!detail) return {}
    return loadOf((detail.entries || []).map(row => ({
      id: row.id,
      ex: row.exercise,
      sets: (row.sets || []).reduce((n, set) => n + doneUnits(set), 0),
    })))
  }, [detail])
  const workoutMuscles = inMuscleOrder(Object.keys(workoutLoad).filter(slug => workoutLoad[slug] > 0))

  return <div className="act-ex-sheet">
    <div className="fin-x"><button type="button" className="iconbtn" aria-label={t('Close')} onClick={close}><Icon name="xmark" /></button></div>
    <h3>{t('Exercise stats')}</h3>
    <div className="muted small act-ex-sub">
      {item.owner?.me ? t('You') : (item.owner?.name || '')}
      {item.workout?.name ? ' · ' + item.workout.name : ''}
      {item.date ? ' · ' + fmtDate(item.date, true, true) : ''}
    </div>

    {loading && <div className="empty">{t('Loading…')}</div>}
    {!loading && error && <div className="card social-error-card" role="alert">
      <div className="small">{socialError(error)}</div>
      <Button size="sm" icon="reset" onClick={() => { setError(null); setLoading(true); socialWorkout(item.id).then(a => setDetail(a?.workout || null)).catch(setError).finally(() => setLoading(false)) }}>{t('Try again')}</Button>
    </div>}
    {!loading && !error && (!entry
      ? <div className="empty">{t('No sets in this workout.')}</div>
      : <>
        <div className="act-ex-title">{exerciseName(entry)}</div>
        {entryMuscles.length > 0 && <div className="chips act-ex-chips">
          {entryMuscles.map(slug => <span className="chip" key={slug}>{muscleLabel(slug)}</span>)}
        </div>}

        <div className="act-ex-stats">
          <div><b>{setCount}</b><span>{t('Sets')}</span></div>
          <div><b>{reps}</b><span>{t('Reps')}</span></div>
          <div><b>{fmtVol(volume, unit)}</b><span>{t('Volume')}</span></div>
        </div>

        {top && <div className="act-ex-top">
          <span>{t('Top set')}</span>
          <b>{setText(top.set, unit)}</b>
        </div>}

        <h4 className="sec">{t('In this workout')}</h4>
        <div className="act-ex-sets">
          {sets.map((set, i) => <div className="act-ex-set" key={i}>
            <span>{t('Set {0}', i + 1)}</span>
            <b>{setText(set, unit)}</b>
          </div>)}
        </div>

        {workoutMuscles.length > 0 && <>
          <h4 className="sec">{t('Muscle groups in this workout')}</h4>
          <div className="chips act-ex-chips">
            {workoutMuscles.map(slug => <span className="chip" key={slug}>
              {muscleLabel(slug)} <b>{fmtNum(workoutLoad[slug])}</b>
            </span>)}
          </div>
        </>}
      </>)}
    <div className="act-ex-done"><Button variant="ghost" onClick={close}>{t('Done')}</Button></div>
  </div>
}

export const activityExerciseSheet = (item, exerciseId, localDetail = null) => useUI.getState().openSheet(close =>
  <ActivityExerciseSheet item={item} exerciseId={exerciseId} close={close} localDetail={localDetail} />
)
