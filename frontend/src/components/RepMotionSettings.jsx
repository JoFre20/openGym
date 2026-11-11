import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { useRepMotionSupport } from '../lib/use-rep-support.js'
import { Section, Row, Segmented } from './ui.jsx'

/**
 * The motion rep settings, shared by the in-workout sheet and Settings → Workout. Nothing renders
 * outside the native iPhone app: `useRepMotionSupport` is false on the web and on Android.
 */
export function RepMotionSettings() {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const rep = useRepMotionSupport()
  if (!rep.ready || !rep.iphone) return null
  const mode = S.repMotionMode === 'confirm' || S.repMotionMode === 'manual' ? S.repMotionMode : 'auto'
  const end = [4, 6, 10, 15].includes(Number(S.repMotionSetEndSec)) ? Number(S.repMotionSetEndSec) : 6
  const calib = Number(S.repMotionCalibReps) === 1 ? 1 : 3
  const watchText = rep.watch ? t('Ready') : rep.watchReason === 'not_paired' ? t('Watch not paired')
    : rep.watchReason === 'not_installed' ? t('Watch app not installed')
      : rep.watchReason === 'unreachable' ? t('Watch not reachable') : t('Not available')
  return <Section title={t('Motion rep counting')}
    footer={t('Calibrations stay on this device, one per exercise and sensor. The web and Android do not offer this.')}>
    <Row icon="waveform" iconTint="var(--green)" title={t('Set end')} subtitle={t('Automatic is hands-free; Confirm asks before a set is logged.')}>
      <Segmented className="seg-inline"
        options={[{ value: 'auto', label: t('Automatic') }, { value: 'confirm', label: t('Confirm') }, { value: 'manual', label: t('Manual') }]}
        value={mode} onChange={v => update(s => { s.repMotionMode = v })} />
    </Row>
    <Row icon="timer" iconTint="var(--orange)" title={t('Set ends after')}>
      <Segmented className="seg-inline"
        options={[4, 6, 10, 15].map(n => ({ value: n, label: t('{0} s', n) }))}
        value={end} onChange={v => update(s => { s.repMotionSetEndSec = v })} />
    </Row>
    <Row icon="target" iconTint="var(--purple)" title={t('Calibration')} subtitle={t('How many clean reference repetitions to record.')}>
      <Segmented className="seg-inline"
        options={[{ value: 1, label: '1' }, { value: 3, label: '3' }]}
        value={calib} onChange={v => update(s => { s.repMotionCalibReps = v })} />
    </Row>
    <Row icon="watch" iconTint="var(--blue)" title={t('Watch sensor')} subtitle={watchText}
      onClick={() => rep.refresh()} accessory="chevron" />
  </Section>
}
