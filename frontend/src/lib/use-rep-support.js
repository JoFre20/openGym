// Whether this app can count reps at all, and whether the watch sensor is ready right now. Kept in
// a hook so the workout menu, the tracker sheet and Settings agree without each asking the native
// bridge. On the web and on Android this resolves to no support and no UI appears.
import { useCallback, useEffect, useRef, useState } from 'react'
import { repMotionSupport } from './motion-source.js'

const INITIAL = { ready: false, iphone: false, watch: false, watchReason: 'checking' }

export function useRepMotionSupport() {
  const [support, setSupport] = useState(INITIAL)
  const alive = useRef(true)
  const ask = useCallback(async () => {
    let next
    try { next = await repMotionSupport() }
    catch { next = { ready: true, iphone: false, watch: false, watchReason: 'unsupported' } }
    if (alive.current) setSupport(next)
    return next
  }, [])
  useEffect(() => {
    alive.current = true
    ask()
    return () => { alive.current = false }
  }, [ask])
  return { ...support, refresh: ask }
}
