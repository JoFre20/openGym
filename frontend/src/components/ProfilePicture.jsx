import { useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { avatarErrorText, makeAvatarDataUrl } from '../lib/avatar.js'
import { t } from '../lib/i18n.js'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import Avatar from './Avatar.jsx'
import Icon from './Icon.jsx'
import { Row, Section } from './ui.jsx'

/**
 * Settings → Account: a picture the person can add, change or remove. The file never leaves the
 * device as picked; lib/avatar.js re-encodes it to a small 192 px WebP/JPEG and the API stores the
 * result as a data URL on the social profile (api/avatar.js). The row itself is the picker, so
 * the mobile layout has no extra button competing with the avatar.
 */
export default function ProfilePicture() {
  const user = useStore(s => s.user)
  const patchUser = useStore(s => s.patchUser)
  const toast = useUI(s => s.toast)
  const fileRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const hasPicture = !!(user && user.avatar)

  if (!user) return null

  const pick = () => { if (!busy) fileRef.current?.click() }

  const onFile = async event => {
    const file = event.target.files && event.target.files[0]
    event.target.value = ''   // picking the same file again still fires this
    if (!file || busy) return
    setBusy(true)
    try {
      const avatar = await makeAvatarDataUrl(file)
      await api('/api/account/avatar', { method: 'PUT', body: JSON.stringify({ avatar }) })
      patchUser({ avatar })
      toast(t('Profile picture updated'))
    } catch (e) {
      toast(avatarErrorText(e))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (busy) return
    setBusy(true)
    try {
      await api('/api/account/avatar', { method: 'DELETE' })
      patchUser({ avatar: null })
      toast(t('Profile picture removed'))
    } catch (e) {
      toast(avatarErrorText(e))
    } finally {
      setBusy(false)
    }
  }

  return <>
    <Section title={t('Profile picture')}>
      <button type="button" className="lrow tap pp-row" onClick={pick} disabled={busy}>
        <Avatar name={user.name} avatar={user.avatar} size="lg" />
        <span className="lrow-m">
          <span className="lrow-t">{busy ? t('Loading…') : hasPicture ? t('Change') : t('Add')}</span>
          <span className="lrow-s">{t('Your friends see this picture.')}</span>
        </span>
        <Icon name="chevronRight" className="lrow-c" />
      </button>
      {hasPicture && <Row icon="trash" iconTint="var(--red)" title={t('Remove')} danger onClick={remove} />}
    </Section>
    <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
  </>
}
