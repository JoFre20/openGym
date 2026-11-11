import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { fmtNum } from '../lib/format.js'
import { vibrate } from '../lib/sound.js'
import { templateQuality } from '../lib/rep-core.js'
import { deleteRepTemplate, readRepTemplate, writeRepTemplate } from '../lib/rep-templates.js'
import { closeThenNav } from '../lib/nav.js'
import { useRepMotionSupport } from '../lib/use-rep-support.js'
import { useRepTracker } from '../lib/use-rep-tracker.js'
import { Button, Segmented } from './ui.jsx'
import Icon from './Icon.jsx'
import './RepTracker.css'

const SOURCES = {
  iphone: { label: () => t('iPhone'), icon: 'phoneScreen' },
  watch: { label: () => t('Apple Watch'), icon: 'watch' },
}

function sourceLabel(source) {
  return SOURCES[source]?.label() || t('iPhone')
}

function errorText(code, detectedReps) {
  switch (code) {
    case 'too_short': return t('The recording was too short. Try again.')
    case 'too_long': return t('The recording was too long. Try again.')
    case 'too_weak': return t('Too little movement. Perform clean, full reps.')
    case 'one_direction': return t('One direction only. Perform a full repetition.')
    case 'not_enough_reps': return detectedReps ? t('Only {0} repetitions recognized. Try again.', detectedReps) : t('Not enough repetitions recognized. Try again.')
    case 'no_template': return t('Calibrate this exercise first.')
    case 'unavailable': return t('The motion sensor is not available on this device.')
    case 'unsupported': return t('Motion counting is only available in the iPhone app.')
    case 'watch_unavailable': return t('The Watch is not paired or the openGym Watch app is not installed.')
    case 'watch_unreachable':
    case 'watch_timeout': return t('The Watch is not reachable. Open openGym on the Watch and keep it close.')
    case 'watch_stopped': return t('The Watch stopped sending motion data. Counting is paused.')
    case 'watch_gap': return t('A gap in the Watch data was found. Counting is paused.')
    case 'watch_error': return t('The Watch could not start the motion sensor.')
    case 'background':
    case 'sensor_error':
    case 'sensor_stopped': return t('The motion sensor stopped. Try again.')
    case 'no_reps': return t('No repetitions were counted.')
    default: return t('Motion counting could not start. Try again.')
  }
}

function qualityText(template) {
  const q = templateQuality(template)
  return q === 'good' ? t('Good') : q === 'ok' ? t('OK') : t('Weak')
}

function Signal({ wave, range = 4 }) {
  const max = Math.max(1, Number(range) || 4)
  const n = 70
  const points = wave?.length > 1
    ? wave.map((v, i) => {
      const x = ((i + (n - wave.length)) / (n - 1)) * 300
      const y = 44 - Math.max(-max, Math.min(max, v)) / max * 36
      return `${x.toFixed(1)},${y.toFixed(1)}`
    }).join(' ')
    : ''
  return <div className="rt-spark" aria-hidden="true">
    <svg viewBox="0 0 300 88" preserveAspectRatio="none">
      <line x1="0" y1="44" x2="300" y2="44" className="rt-mid" />
      {points && <polyline points={points} className="rt-trace" />}
    </svg>
    <span>{t('Movement signal')}</span>
  </div>
}

function SourcePicker({ source, onPick, support, disabled }) {
  return <div className="rt-source" role="group" aria-label={t('Sensor')}>
    {Object.entries(SOURCES).map(([id, s]) => {
      const available = id === 'iphone' ? support.iphone : support.watch
      const on = source === id
      return <button key={id} type="button" className={'rt-source-btn' + (on ? ' on' : '') + (!available ? ' dis' : '')}
        aria-pressed={on} disabled={disabled} onClick={() => onPick(id)}>
        <Icon name={s.icon} />
        <span>{s.label()}</span>
        <small>{id === 'iphone' ? t('This phone') : available ? t('Ready') : t('Not available')}</small>
      </button>
    })}
  </div>
}

export function RepTrackerSheet({ exerciseId, exerciseName, setLabel, side, onDone, close }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const support = useRepMotionSupport()
  const mode = S.repMotionMode === 'confirm' || S.repMotionMode === 'manual' ? S.repMotionMode : 'auto'
  const setEndSec = Number(S.repMotionSetEndSec) > 0 ? Number(S.repMotionSetEndSec) : 6
  const preferred = S.repMotionSource === 'watch' ? 'watch' : 'iphone'
  const [source, setSource] = useState(preferred)
  const [calibrationReps, setCalibrationReps] = useState(Number(S.repMotionCalibReps) === 1 ? 1 : 3)
  const [template, setTemplate] = useState(() => readRepTemplate(exerciseId, preferred))
  const [healthOn, setHealthOn] = useState(null)

  useEffect(() => {
    if (source !== 'watch' || !support.ready || !support.watch) { setHealthOn(null); return }
    let alive = true
    import('../lib/health-sync.js')
      .then(hs => hs.loadHealth())
      .then(h => { if (alive) setHealthOn(!!h?.on) })
      .catch(() => { if (alive) setHealthOn(null) })
    return () => { alive = false }
  }, [source, support.ready, support.watch])

  const tracker = useRepTracker({
    exerciseId,
    source,
    template,
    mode,
    setEndSec,
    onRep: () => { vibrate(12) },
    onSetFinished: (reps) => {
      onDone?.(reps, side)
      close?.()
    },
    onTemplateRecorded: next => {
      writeRepTemplate(next)
      setTemplate(next)
      update(s => { s.repMotionSource = source; s.repMotionCalibReps = calibrationReps })
    },
  })
  const { state } = tracker
  const active = ['countdown', 'recording', 'tracking', 'confirm'].includes(state.phase)
  const quality = template ? qualityText(template) : null
  const range = template ? Math.max(Math.abs(template.pMax), Math.abs(template.pMin), 3) : 4
  const title = exerciseName || S.active?.entries?.find(e => e.id === exerciseId)?.name || exerciseId
  const cannotStart = !support.iphone || (source === 'watch' && !support.watch)

  const pickSource = next => {
    if (active || !support.ready) return
    if (next === 'iphone' && !support.iphone) return
    setSource(next)
    setTemplate(readRepTemplate(exerciseId, next))
    update(s => { s.repMotionSource = next })
    void tracker.reset()
  }

  const pickCalibrationReps = n => {
    setCalibrationReps(n)
    update(s => { s.repMotionCalibReps = n })
  }

  const begin = () => {
    if (template) tracker.startTracking()
    else tracker.startCalibration({ reps: calibrationReps })
  }

  const finish = () => {
    if (state.phase !== 'tracking') return
    if (state.reps > 0) void tracker.finishTracking(true)
    else close?.()
  }

  const removeTemplate = () => {
    deleteRepTemplate(exerciseId, source)
    setTemplate(null)
    void tracker.reset()
  }

  const showWatchBanner = source === 'watch' && support.ready && !support.watch
  const watchReason = support.watchReason === 'not_paired' ? t('The Watch is not paired.')
    : support.watchReason === 'not_installed' ? t('The openGym Watch app is not installed.')
      : support.watchReason === 'unreachable' ? t('The Watch is not reachable. Open openGym on the Watch and keep it close.')
        : t('No Watch sensor is available.')

  const header = <>
    <div className="rt-head">
      <div>
        <h3>{t('Count reps by movement')}</h3>
        <div className="rt-sub">{title}{setLabel ? ' · ' + setLabel : ''}</div>
      </div>
      <button type="button" className="rt-close" aria-label={t('Close')} onClick={() => close?.()}>
        <Icon name="xmark" />
      </button>
    </div>
  </>

  return <div className="rt-sheet">
    {header}
    {!support.ready && <div className="rt-muted">{t('Checking the motion sensor…')}</div>}
    {support.ready && !support.iphone && <div className="rt-banner warn">
      <Icon name="warning" />
      <div>{t('Motion counting is only available in the iPhone app.')}</div>
    </div>}
    {support.ready && support.iphone && <>
      <SourcePicker source={source} onPick={pickSource} support={support} disabled={active} />
      {showWatchBanner && <div className="rt-banner warn">
        <Icon name="watch" />
        <div><b>{t('Watch sensor')}</b><br />{watchReason}</div>
        <button type="button" className="rt-mini" onClick={() => support.refresh()}>{t('Check again')}</button>
      </div>}
      {source === 'watch' && !showWatchBanner && <div className="rt-source-note">
        <Icon name="info" /> {t('The Watch only sends movement data. Counting happens on this iPhone.')}
      </div>}
      {!active && source === 'watch' && support.watch && healthOn === false && <div className="rt-banner warn">
        <Icon name="heart" />
        <div>{t('Without Apple Health, keep the Watch app open while counting. For background sensing, turn on Apple Health on this iPhone.')}</div>
        <button type="button" className="rt-mini" onClick={() => closeThenNav(close, '/settings/apple-health')}>
          {t('Apple Health settings')}
        </button>
      </div>}

      {state.phase === 'idle' && <>
        {state.error && <div className="rt-banner bad"><Icon name="warning" /><div>{errorText(state.error, state.calibration?.detectedReps)}</div></div>}
        {template ? <>
          <div className="rt-counter">
            <div className="rt-big">0</div>
            <div className="rt-unit">{t('Reps')}</div>
          </div>
          <div className="rt-card">
            <div className="rt-kv"><span>{t('Calibration')}</span><b>{sourceLabel(source)}</b></div>
            <div className="rt-kv"><span>{t('Duration')}</span><b>{fmtNum(template.durationMs / 1000)} s</b></div>
            <div className="rt-kv"><span>{t('Quality')}</span><b>{quality}</b></div>
          </div>
          <div className="rt-actions">
            <Button variant="primary" icon="play" onClick={begin}>{t('Start set')}</Button>
            <div className="rt-actions-row">
              <Button icon="waveform" onClick={() => tracker.startCalibration({ reps: calibrationReps })}>{t('Calibrate again')}</Button>
              <Button variant="ghost" onClick={removeTemplate}>{t('Delete calibration')}</Button>
            </div>
          </div>
        </> : <>
          <div className="rt-empty">
            <Icon name="waveform" />
            <h4>{t('Calibrate this exercise')}</h4>
            <p>{source === 'watch'
              ? t('Fasten the Watch to the machine or wear it, then perform 1 or 3 clean repetitions. The iPhone records the movement and counts later sets.')
              : t('Put the iPhone in a pocket or on an armband, then perform 1 or 3 clean repetitions.')}</p>
          </div>
          <div className="rt-calib-choice">
            <span>{t('Reference repetitions')}</span>
            <Segmented options={[{ value: 1, label: '1' }, { value: 3, label: '3' }]}
              value={calibrationReps} onChange={pickCalibrationReps} className="rt-seg" />
          </div>
          <div className="rt-actions">
            <Button variant="primary" icon="waveform" disabled={cannotStart} onClick={begin}>{t('Record reference')}</Button>
          </div>
        </>}
      </>}

      {state.phase === 'countdown' && <>
        <div className="rt-countdown">
          <div className="rt-count">{state.countdown}</div>
          <p>{state.kind === 'calibration' ? t('Get ready for the reference repetitions') : t('Get ready to count the set')}</p>
          <small>{t('Place the device and hold still.')}</small>
        </div>
        <Button variant="ghost" onClick={() => tracker.reset()}>{t('Cancel')}</Button>
      </>}

      {state.phase === 'recording' && <>
        <div className="rt-rec">● {t('Recording')}</div>
        <div className="rt-counter compact">
          <div className="rt-big small">{calibrationReps === 1 ? '1' : '3'}</div>
          <div className="rt-unit">{calibrationReps === 1 ? t('clean repetition') : t('clean repetitions')}</div>
        </div>
        <Signal wave={state.wave} range={4} />
        <p className="rt-muted center">{t('The recording stops by itself when the device is still.')}</p>
        <Button variant="danger" onClick={() => tracker.finishCalibration()}>{t('Finish recording')}</Button>
      </>}

      {state.phase === 'calibrated' && state.calibration?.ok && <>
        <div className="rt-banner ok"><Icon name="checkCircle" /><div>
          <b>{t('Calibration saved')}</b><br />
          {t('Duration {0} s · Movement {1} m/s² · {2}', fmtNum(state.calibration.template.durationMs / 1000), fmtNum(state.calibration.template.peakToPeak), qualityText(state.calibration.template))}
        </div></div>
        <div className="rt-actions">
          <Button variant="primary" icon="play" onClick={() => tracker.startTracking()}>{t('Start set')}</Button>
          <Button icon="waveform" onClick={() => tracker.startCalibration({ reps: calibrationReps })}>{t('Record again')}</Button>
        </div>
      </>}

      {state.phase === 'tracking' && <>
        <div className="rt-counter">
          <div className="rt-big">{state.reps}</div>
          <div className="rt-unit">{t('Reps')}</div>
        </div>
        <div className="rt-status">
          <span className="rt-pill"><span className="rt-dot" />{sourceLabel(source)}</span>
          {state.lastRepDurationMs != null && <span className="rt-muted">{t('Last rep')} {fmtNum(state.lastRepDurationMs / 1000)} s</span>}
        </div>
        <Signal wave={state.wave} range={range} />
        {mode !== 'manual' && state.reps > 0 && <div className="rt-timer">
          <span>{t('Set ends automatically')}</span><b>{state.autoRemaining} s</b>
        </div>}
        <div className="rt-actions">
          <Button variant="primary" icon="check" disabled={state.reps === 0} onClick={finish}>{t('Finish set')}</Button>
          <Button variant="ghost" onClick={() => tracker.reset()}>{t('Cancel')}</Button>
        </div>
      </>}

      {state.phase === 'confirm' && <>
        <div className="rt-counter">
          <div className="rt-big">{state.reps}</div>
          <div className="rt-unit">{t('Reps')}</div>
        </div>
        <div className="rt-card">
          <div className="rt-kv"><span>{t('Last rep')}</span><b>{state.lastRepDurationMs != null ? fmtNum(state.lastRepDurationMs / 1000) + ' s' : '-'}</b></div>
        </div>
        <div className="rt-actions">
          <Button variant="primary" icon="check" onClick={() => tracker.accept()}>{t('Accept')}</Button>
          <Button onClick={() => tracker.resume()}>{t('Keep counting')}</Button>
          <Button variant="ghost" onClick={() => { tracker.discard(); close?.() }}>{t('Discard')}</Button>
        </div>
      </>}

      {state.phase === 'finished' && <>
        <div className="rt-banner ok"><Icon name="checkCircle" /><div>{t('Set saved')}</div></div>
        <Button variant="primary" onClick={() => close?.()}>{t('Done')}</Button>
      </>}

      {state.phase === 'error' && <>
        <div className="rt-banner bad"><Icon name="warning" /><div>{errorText(state.error)}</div></div>
        <div className="rt-actions">
          {state.reps > 0 && <Button variant="primary" onClick={() => tracker.accept()}>{t('Accept {0} reps', state.reps)}</Button>}
          {source === 'watch' && <Button onClick={() => support.refresh()}>{t('Check again')}</Button>}
          <Button variant="ghost" onClick={() => tracker.reset()}>{t('Try again')}</Button>
        </div>
      </>}
    </>}
  </div>
}

/** Opens the tracker as a bottom sheet. */
export function repTrackerSheet(opts) {
  return useUI.getState().openSheet(close => <RepTrackerSheet {...opts} close={close} />)
}
