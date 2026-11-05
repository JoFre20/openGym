import { useEffect, useState } from 'react'
import { avatarSrc } from '../lib/avatar.js'
import { initialsOf } from '../lib/social-view.js'

/**
 * A round identity mark: the profile picture when there is one, otherwise the initials the
 * Friends screen has always used. `avatar` is the small data URL stored on the account; null,
 * absent or malformed values fall back without leaving a broken image behind.
 */
export default function Avatar({ name, avatar, size = 'md', className = '' }) {
  const [broken, setBroken] = useState(false)
  useEffect(() => { setBroken(false) }, [avatar])
  const src = broken ? null : avatarSrc(avatar)
  return <span className={'avatar avatar-' + size + (className ? ' ' + className : '')} aria-hidden="true">
    {src ? <img src={src} alt="" draggable={false} onError={() => setBroken(true)} /> : initialsOf(name)}
  </span>
}
