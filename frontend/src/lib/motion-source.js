// The two motion sources the rep tracker accepts. There is deliberately no web source: a browser
// cannot be trusted to deliver 50 Hz of continuous acceleration while the screen is in a pocket,
// and a silent wrong count is worse than no feature. Both sources are native.
//
//   iphone  ios/App/App/MotionPlugin.swift, CMMotionManager, samples forwarded as they arrive.
//   watch   the Watch app's MotionSensor.swift, CMMotionManager on the wrist, sent over
//           WatchConnectivity to ios/App/App/WatchBridgePlugin.swift. The watch does not count in
//           this mode; the phone gets the samples and runs the same rep-core as for the iPhone.
import { MOBILE, nativePlatform } from './mobile.js'
import { watchBridge } from './watch-sync.js'

export const MOTION_HZ = 50
export const MOTION_BATCH = 5

const fail = code => Object.assign(new Error(code), { code })
const withTimeout = (promise, ms = 5000, code = 'watch_timeout') => Promise.race([
  promise,
  new Promise(resolve => setTimeout(() => resolve({ ok: false, code }), ms)),
])
const sampleOf = row => Array.isArray(row)
  ? { t: Number(row[0]) || 0, x: Number(row[1]) || 0, y: Number(row[2]) || 0, z: Number(row[3]) || 0 }
  : { t: Number(row?.t) || 0, x: Number(row?.x) || 0, y: Number(row?.y) || 0, z: Number(row?.z) || 0 }

const iphonePlugin = async () => {
  if (!MOBILE) return null
  let platform = null
  try { platform = await nativePlatform?.() } catch { platform = null }
  if (platform !== 'ios') return null
  try {
    const { registerPlugin } = await import('@capacitor/core')
    return registerPlugin('Motion')
  } catch { return null }
}

/**
 * What the device can do. `iphone` is the phone's own CoreMotion bridge. `watch` is a paired,
 * installed and reachable Apple Watch. Both can be false on the web and on Android.
 */
export async function repMotionSupport() {
  if (!MOBILE) return { ready: true, iphone: false, watch: false, watchReason: 'unsupported' }
  let platform = null
  try { platform = await nativePlatform?.() } catch { platform = null }
  if (platform !== 'ios') return { ready: true, iphone: false, watch: false, watchReason: 'unsupported' }
  const phone = !!(await iphonePlugin())
  const link = await watchBridge()
  if (!link) return { ready: true, iphone: phone, watch: false, watchReason: 'unsupported' }
  try {
    const s = await Promise.resolve(link.WatchBridge.status())
    const watch = !!(s && s.supported && s.paired && s.installed && s.reachable)
    const watchReason = !s?.supported ? 'unsupported' : !s?.paired ? 'not_paired' : !s?.installed ? 'not_installed' : !s?.reachable ? 'unreachable' : null
    return { ready: true, iphone: phone, watch, watchReason }
  } catch {
    return { ready: true, iphone: phone, watch: false, watchReason: 'unreachable' }
  }
}

/**
 * Start native iPhone motion. Resolves with { stop }. `onError` gets { code } when the sensor
 * stops on its own (background, unavailable).
 */
export async function startPhoneMotion({ onSamples, onError }) {
  const Motion = await iphonePlugin()
  if (!Motion) throw fail('unsupported')
  let handle = null
  let stopped = false
  const stop = async () => {
    if (stopped) return
    stopped = true
    try { await Motion.stop() } catch { /* already stopped */ }
    try { await handle?.remove() } catch { /* already gone */ }
  }
  try {
    handle = await Motion.addListener('motion', event => {
      if (Array.isArray(event?.samples) && event.samples.length) onSamples?.(event.samples.map(sampleOf))
      else if (event?.ended) onError?.({ code: event.reason || 'stopped' })
    })
    const started = await Motion.start({ hz: MOTION_HZ, batchSize: MOTION_BATCH })
    if (started?.supported === false) { await stop(); throw fail('unavailable') }
  } catch (e) {
    await stop()
    throw e?.code ? e : fail('unavailable')
  }
  return { stop }
}

/**
 * Start the watch as a pure sensor. The watch sends batches with a sequence number; the tracker
 * watches for gaps and pauses rather than count from an incomplete signal. Resolves with { stop }.
 */
export async function startWatchMotion({ onSamples, onState }) {
  const link = await watchBridge()
  if (!link) throw fail('unsupported')
  const bridge = link.WatchBridge
  let status = null
  try { status = await bridge.status() } catch { /* treated as unreachable below */ }
  if (!status?.supported || !status?.paired || !status?.installed) throw fail('watch_unavailable')
  if (!status?.reachable) throw fail('watch_unreachable')

  let stopped = false
  let sampleHandle = null
  let stateHandle = null
  const stop = async () => {
    if (stopped) return
    stopped = true
    try { await withTimeout(bridge.stopMotion({}), 2500) } catch { /* watch may already have gone */ }
    try { await sampleHandle?.remove() } catch { /* already gone */ }
    try { await stateHandle?.remove() } catch { /* already gone */ }
  }
  try {
    sampleHandle = await bridge.addListener('motionSamples', event => {
      if (Array.isArray(event?.samples) && event.samples.length) {
        onSamples?.(event.samples.map(sampleOf), { seq: Number(event.seq) || 0, firstT: Number(event.firstT) || 0 })
      }
    })
    stateHandle = await bridge.addListener('motionState', event => {
      if (event?.state === 'started') onState?.({ state: 'started', hz: Number(event.hz) || MOTION_HZ })
      else if (event?.state === 'ended') onState?.({ state: 'ended', reason: event.reason || 'stopped' })
      else if (event?.state === 'error') onState?.({ state: 'error', code: event.code || 'watch_error' })
    })
    const started = await withTimeout(bridge.startMotion({ hz: MOTION_HZ, batchSize: MOTION_BATCH }))
    if (!started?.ok) { await stop(); throw fail(started?.code || 'watch_unavailable') }
  } catch (e) {
    await stop()
    throw e?.code ? e : fail('watch_unavailable')
  }
  return { stop }
}
