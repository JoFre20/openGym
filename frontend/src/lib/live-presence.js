// The athlete's heartbeat while a workout is running. It lives in the shell, not on the workout
// screen: leaving that screen to check Stats or the Friends page does not end the session, and a
// friend following along should not see the athlete disappear for it. Finish, discard and sign-out
// end it; a hidden page marks it away and a closing tab drops it.
import { useEffect, useRef } from 'react'
import { api, beacon } from './api.js'
import { buildLivePayload, liveWorkoutKey } from './live-workout.js'
import { useUI } from '../store/useUI.js'
import { useStore } from '../store/useStore.js'

export const LIVE_HEARTBEAT_MS = 20000

const leftBody = reason => ({ active: false, ...(reason ? { reason } : {}) })

/** Stop the live row for the running workout, leaving the saved shareLive setting for next time. */
export function pauseLiveSharing() {
  const A = useStore.getState().S.active
  useUI.setState({ livePausedWorkoutId: liveWorkoutKey(A), liveShared: false })
  api('/api/activity', { method: 'POST', body: JSON.stringify(leftBody('navigated')) }).catch(() => {})
}

export function useLivePresence() {
  const user = useStore(s => s.user)
  const ready = useStore(s => s.ready)
  const activeKey = useStore(s => liveWorkoutKey(s.S.active))
  const tickRef = useRef(null)

  useEffect(() => {
    if (!ready || !user) {
      useUI.setState({ liveShared: false })
      tickRef.current = null
      return undefined
    }
    let stopped = false
    let sent = false
    const post = body => api('/api/activity', { method: 'POST', body: JSON.stringify(body) }).catch(() => null)
    const leave = (reason, viaBeacon = false) => {
      if (!sent) return
      sent = false
      useUI.setState({ liveShared: false })
      const body = leftBody(reason)
      if (viaBeacon) beacon('/api/activity', body)
      else post(body)
    }
    const ping = () => {
      if (stopped) return
      const state = useStore.getState()
      const paused = !!(state.S.active && useUI.getState().livePausedWorkoutId === liveWorkoutKey(state.S.active))
      let payload = null
      try {
        payload = paused ? null : buildLivePayload({
          active: state.S.active,
          workouts: state.S.workouts,
          restSec: state.S.restSec,
          tourSandbox: state.tourSandbox,
        })
      } catch { payload = null }
      if (payload) {
        sent = true
        post(payload).then(answer => {
          if (!stopped && answer && typeof answer.shared === 'boolean') {
            useUI.setState({ liveShared: answer.shared })
          }
        })
      } else if (sent) {
        leave('navigated')
      } else {
        useUI.setState({ liveShared: false })
      }
    }
    tickRef.current = ping
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') leave('hidden', true)
      else ping()
    }
    const onHide = () => leave('closed', true)
    const onShow = event => { if (event.persisted) ping() }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onHide)
    window.addEventListener('pageshow', onShow)
    const iv = setInterval(() => { if (!stopped) ping() }, LIVE_HEARTBEAT_MS)
    return () => {
      stopped = true
      clearInterval(iv)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onHide)
      window.removeEventListener('pageshow', onShow)
      tickRef.current = null
      if (sent) {
        useUI.setState({ liveShared: false })
        post(leftBody('navigated'))
      }
    }
  }, [ready, user?.id])

  // A session starting or ending is its own event: start the row at once, and take it down at
  // once when the workout is finished or discarded. The interval only keeps it fresh.
  useEffect(() => {
    if (!ready || !user) return
    const paused = useUI.getState().livePausedWorkoutId
    if (paused && paused !== liveWorkoutKey(useStore.getState().S.active)) {
      useUI.setState({ livePausedWorkoutId: null })
    }
    tickRef.current?.()
  }, [activeKey, ready, user?.id])
}
