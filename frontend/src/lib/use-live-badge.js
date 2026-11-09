// The polling half of the live badge. Kept in a hook so the tab bar only has to ask whether
// anyone is live; the store itself stays free of React and testable on its own.
import { useEffect } from 'react'
import { useStore } from '../store/useStore.js'
import { clearLiveBadge, LIVE_BADGE_MS, refreshLiveBadge } from './live-badge.js'

export function useLiveBadge() {
  const ready = useStore(s => s.ready)
  const userId = useStore(s => s.user?.id)
  useEffect(() => {
    if (!ready || !userId) {
      clearLiveBadge()
      return undefined
    }
    let stopped = false
    const tick = () => {
      if (!stopped && document.visibilityState !== 'hidden') refreshLiveBadge(userId)
    }
    tick()
    const iv = setInterval(tick, LIVE_BADGE_MS)
    const onVisibility = () => { if (document.visibilityState !== 'hidden') tick() }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', tick)
    return () => {
      stopped = true
      clearInterval(iv)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', tick)
      clearLiveBadge(userId)
    }
  }, [ready, userId])
}
