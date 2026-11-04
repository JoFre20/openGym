import { useRef, useState } from 'react'
import { copyText } from '../lib/clipboard.js'
import { respondToFriendRequest, sendFriendRequest, socialError, socialMe } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { friendCodeComplete, formatFriendCodeInput, friendLinkUrl } from '../lib/social-view.js'
import { shareText } from '../lib/share.js'
import { useSheetKeyboard } from '../lib/use-sheet-keyboard.js'
import { useUI } from '../store/useUI.js'
import { useStore } from '../store/useStore.js'
import Icon from './Icon.jsx'
import { Button, TextField } from './ui.jsx'

export default function AddFriendSheet({ me, initialCode = '', close, onChanged, onFriendChanged }) {
  const toast = useUI(s => s.toast)
  const syncServer = useStore(s => s.sync?.server)
  const [current, setCurrent] = useState(me)
  const [code, setCode] = useState(() => formatFriendCodeInput(initialCode))
  const [busy, setBusy] = useState(false)
  const [busyAction, setBusyAction] = useState('')
  const [error, setError] = useState('')
  const inputRef = useRef(null)
  const onFocus = useSheetKeyboard(inputRef, true, { reveal: true })

  const incoming = (current.pending || []).filter(p => p.direction === 'incoming')
  const outgoing = (current.pending || []).filter(p => p.direction === 'outgoing')
  const complete = friendCodeComplete(code)
  const friendLink = friendLinkUrl(current.friendCode, syncServer)

  const refresh = async () => {
    const next = await socialMe()
    setCurrent(next)
    onChanged(next)
    return next
  }

  const copy = async () => {
    toast(await copyText(current.friendCode) ? t('Copied') : t('Could not copy'))
  }

  const shareLink = async () => {
    if (!friendLink) return
    const how = await shareText(friendLink, { title: t('Add friend') })
    if (how === 'copied') toast(t('Copied'))
    else if (how === 'failed') toast(t('Could not copy'))
  }

  const send = async () => {
    if (!complete || busy) return
    setBusy(true)
    setError('')
    try {
      await sendFriendRequest(code)
      setCode('')
      toast(t('Request sent'))
      try { await refresh() } catch { /* the request is sent even if the list could not be re-read */ }
    } catch (e) {
      setError(socialError(e))
    } finally {
      setBusy(false)
    }
  }

  const answer = async (request, action) => {
    if (busyAction) return
    setBusyAction(request.id + action)
    setError('')
    try {
      await respondToFriendRequest(request.id, action)
    } catch (e) {
      setError(socialError(e))
      setBusyAction('')
      return
    }
    try { await refresh() } catch { /* the answer reached the server even if the list could not be re-read */ }
    if (action === 'accept') {
      toast(t('Friend added'))
      onFriendChanged?.()
    } else if (action === 'decline') {
      toast(t('Request declined'))
    } else {
      toast(t('Request cancelled'))
    }
    setBusyAction('')
  }

  return <div className="kb-lift social-add-sheet">
    <h3>{t('Add friend')}</h3>

    <button type="button" className="social-code" onClick={copy} aria-label={t('Copy friend code')}>
      <span className="social-code-main">
        <span className="social-code-label">{t('Your friend code')}</span>
        <span className="social-code-value">{current.friendCode}</span>
      </span>
      <Icon name="copy" />
    </button>
    <Button className="social-share" variant="tinted" icon="share" disabled={!friendLink} onClick={shareLink}>
      {t('Share friend link')}
    </Button>

    <label className="social-code-field">
      <span>{t('Friend code')}</span>
      <TextField ref={inputRef} value={code} onFocus={onFocus} maxLength={7}
        placeholder="A7X-92B" autoCapitalize="characters" autoCorrect="off" spellCheck={false}
        enterKeyHint="send" inputMode="text"
        onChange={e => setCode(formatFriendCodeInput(e.target.value))}
        onKeyDown={e => { if (e.key === 'Enter') send() }} />
    </label>
    {error && <div className="social-error-text" role="alert">{error}</div>}
    <Button className="social-code-send" variant="primary" icon="people" disabled={!complete || busy} onClick={send}>
      {busy ? t('Sending…') : t('Send request')}
    </Button>

    {incoming.length > 0 && <section className="social-requests">
      <h4 className="sec">{t('Requests')}</h4>
      <div className="sect-b">
        {incoming.map(request => <div className="social-request" key={request.id}>
          <div className="social-request-main">
            <b>{request.name}</b>
            <span>{t('wants to be friends')}</span>
          </div>
          <div className="social-request-actions">
            <Button size="sm" variant="tinted" disabled={!!busyAction}
              onClick={() => answer(request, 'accept')}>{t('Accept')}</Button>
            <Button size="sm" variant="ghost" className="dim" disabled={!!busyAction}
              onClick={() => answer(request, 'decline')}>{t('Decline')}</Button>
          </div>
        </div>)}
      </div>
    </section>}

    {outgoing.length > 0 && <section className="social-requests">
      <h4 className="sec">{t('Sent')}</h4>
      <div className="sect-b">
        {outgoing.map(request => <div className="social-request" key={request.id}>
          <div className="social-request-main">
            <b>{request.name}</b>
            <span>{t('Waiting for {0}', request.name)}</span>
          </div>
          <Button size="sm" variant="ghost" className="dim" disabled={!!busyAction}
            onClick={() => answer(request, 'remove')}>{t('Cancel')}</Button>
        </div>)}
      </div>
    </section>}

    <div className="social-add-done"><Button variant="primary" onClick={close}>{t('Done')}</Button></div>
  </div>
}
