import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { sendTestPush } from '../lib/push.js'
import { confirmSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button, TextArea, TextField } from '../components/ui.jsx'

/* The operator's side of push delivery.
 *
 * Web Push works without any setup: the server generates VAPID keys on first run. The phone
 * apps need an APNs key or a Firebase service account, and until now those were environment
 * files only. This card lets an admin add, replace and remove them without a restart. It never
 * reads a stored secret back: values go in, metadata and "configured" come out. The admin area
 * stays English-only, like the rest of the dashboard. */

const rel = ts => {
  if (!ts) return 'never'
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return Math.floor(s / 60) + ' min ago'
  if (s < 86400) return Math.floor(s / 3600) + ' h ago'
  return Math.floor(s / 86400) + ' d ago'
}

const sourceLabel = source => ({
  dashboard: 'set here',
  environment: 'from the server environment',
  generated: 'generated on this server',
  'vapid.json': 'generated on this server',
  unreadable: 'stored value can’t be read',
  none: 'not configured',
}[source] || source || 'not configured')

const sourcePill = source => source === 'dashboard' ? 'ok' : source === 'unreadable' ? 'bad' : source === 'environment' ? 'acc' : ''

const env = (label, value) => <div className="adm-kv">
  <span className="k">{label}</span><span className="v">{value || '–'}</span>
</div>

function ApnsSheet({ close, onDone, current }) {
  const toast = useUI(s => s.toast)
  const [key, setKey] = useState('')
  const [keyId, setKeyId] = useState(current?.keyId || '')
  const [teamId, setTeamId] = useState(current?.teamId || '')
  const [bundleId, setBundleId] = useState(current?.bundleId || '')
  const [environment, setEnvironment] = useState(current?.environment || '')
  const [busy, setBusy] = useState(false)
  const keepKey = current?.source === 'dashboard'
  const ready = keyId.trim() && teamId.trim() && bundleId.trim() && (key.trim() || keepKey)

  const save = async () => {
    setBusy(true)
    try {
      await api('/api/admin/push/apns', {
        method: 'POST',
        body: JSON.stringify({ key: key.trim(), keyId, teamId, bundleId, environment }),
      })
      toast('APNs credentials saved')
      close(); onDone()
    } catch (e) { toast(e.message || 'Could not save APNs credentials'); setBusy(false) }
  }

  return <>
    <h3>iPhone push (APNs)</h3>
    <div className="adm-lead">
      From your Apple Developer account: the APNs Auth Key (.p8), its Key ID, the Team ID and the
      app's bundle id. The key is stored encrypted and is never shown again.
    </div>
    <div className="adm-field">
      <label>Private key (.p8 contents)</label>
      <TextArea value={key} rows={4} autoCapitalize="none" autoCorrect="off" spellCheck={false}
        placeholder={keepKey ? 'Leave empty to keep the stored key' : '-----BEGIN PRIVATE KEY-----'}
        onChange={e => setKey(e.target.value)} />
    </div>
    <div className="adm-field">
      <label>Key ID</label>
      <TextField value={keyId} placeholder="ABC123DEFG" autoCapitalize="characters" autoCorrect="off" onChange={e => setKeyId(e.target.value)} />
    </div>
    <div className="adm-field">
      <label>Team ID</label>
      <TextField value={teamId} placeholder="TEAM123456" autoCapitalize="characters" autoCorrect="off" onChange={e => setTeamId(e.target.value)} />
    </div>
    <div className="adm-field">
      <label>Bundle ID</label>
      <TextField value={bundleId} placeholder="com.example.app" autoCapitalize="none" autoCorrect="off" onChange={e => setBundleId(e.target.value)} />
    </div>
    <div className="adm-field">
      <label>Environment</label>
      <select className="adm-select" value={environment} onChange={e => setEnvironment(e.target.value)}>
        <option value="">Automatic (try production, then sandbox)</option>
        <option value="production">Production (TestFlight / App Store)</option>
        <option value="sandbox">Sandbox (debug build)</option>
      </select>
    </div>
    <div className="adm-actions">
      <Button variant="primary" disabled={busy || !ready} onClick={save}>Save credentials</Button>
    </div>
  </>
}

function FcmSheet({ close, onDone }) {
  const toast = useUI(s => s.toast)
  const [text, setText] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  let preview = null
  try {
    const parsed = JSON.parse(text)
    if (parsed && typeof parsed === 'object') preview = { projectId: parsed.project_id, email: parsed.client_email }
  } catch { /* the server gives the useful message */ }

  const pick = async e => {
    const file = e.target.files?.[0]
    if (!file) return
    try { setText(await file.text()); setName(file.name) }
    catch { toast('Could not read that file') }
  }
  const save = async () => {
    setBusy(true)
    try {
      await api('/api/admin/push/fcm', { method: 'POST', body: JSON.stringify({ serviceAccount: text.trim() }) })
      toast('FCM credentials saved')
      close(); onDone()
    } catch (e) { toast(e.message || 'Could not save FCM credentials'); setBusy(false) }
  }

  return <>
    <h3>Android push (FCM)</h3>
    <div className="adm-lead">
      Paste the Firebase service-account JSON (Project settings → Service accounts → Generate new
      private key). Its private key is stored encrypted and is never shown again.
    </div>
    <div className="adm-field">
      <label>Service-account JSON</label>
      <input className="field" type="file" accept=".json,application/json" onChange={pick} />
      <TextArea value={text} rows={7} autoCapitalize="none" autoCorrect="off" spellCheck={false}
        placeholder='{ "type": "service_account", "project_id": "…" }'
        onChange={e => { setText(e.target.value); setName('') }} />
    </div>
    {name && <div className="adm-hint" style={{ marginTop: -4 }}>{name}</div>}
    {preview?.projectId && <div className="adm-hint" style={{ marginTop: -4 }}>
      Project <b>{preview.projectId}</b>{preview.email ? <> · {preview.email}</> : null}
    </div>}
    <div className="adm-actions">
      <Button variant="primary" disabled={busy || !text.trim()} onClick={save}>Save credentials</Button>
    </div>
  </>
}

function VapidKeysSheet({ close, onDone }) {
  const toast = useUI(s => s.toast)
  const [publicKey, setPublicKey] = useState('')
  const [privateKey, setPrivateKey] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try {
      await api('/api/admin/push/vapid', { method: 'POST', body: JSON.stringify({ publicKey: publicKey.trim(), privateKey: privateKey.trim() }) })
      toast('Web Push keys saved')
      close(); onDone()
    } catch (e) { toast(e.message || 'Could not save the Web Push keys'); setBusy(false) }
  }
  return <>
    <h3>Use your own Web Push keys</h3>
    <div className="adm-lead">
      Paste the public and private VAPID keys from another server's <code>data/vapid.json</code>.
      Browsers subscribed against the old keys re-register on their next start. The private key is
      stored encrypted and is never shown again.
    </div>
    <div className="adm-field">
      <label>Public key</label>
      <TextField value={publicKey} autoFocus autoCapitalize="none" autoCorrect="off" spellCheck={false}
        placeholder="B…" onChange={e => setPublicKey(e.target.value)} />
    </div>
    <div className="adm-field">
      <label>Private key</label>
      <TextField value={privateKey} type="password" autoCapitalize="none" autoCorrect="off" spellCheck={false}
        placeholder="paste the private key" onChange={e => setPrivateKey(e.target.value)} />
    </div>
    <div className="adm-actions">
      <Button variant="primary" disabled={busy || !publicKey.trim() || !privateKey.trim()} onClick={save}>Save keys</Button>
    </div>
  </>
}

function SubjectSheet({ close, onDone, current }) {
  const toast = useUI(s => s.toast)
  const [subject, setSubject] = useState(current || '')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try {
      await api('/api/admin/push/vapid', { method: 'POST', body: JSON.stringify({ subject: subject.trim() }) })
      toast('Web Push contact address saved')
      close(); onDone()
    } catch (e) { toast(e.message || 'Could not save the contact address'); setBusy(false) }
  }
  return <>
    <h3>Web Push contact address</h3>
    <div className="adm-lead">
      Push services ask for a contact address for whoever operates this server. It is sent as the
      VAPID subject. Leave empty to use <code>VAPID_SUBJECT</code> or the server origin.
    </div>
    <TextField value={subject} autoFocus placeholder="mailto:you@example.com" autoCapitalize="none" autoCorrect="off"
      onChange={e => setSubject(e.target.value)} />
    <div style={{ height: 12 }} />
    <Button variant="primary" disabled={busy} onClick={save}>Save contact address</Button>
  </>
}

export default function AdminPush() {
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [d, setD] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = () => api('/api/admin/push')
    .then(r => { setD(r); setErr(null); useStore.getState().refreshConfig?.() })
    .catch(e => setErr(e.message || 'Failed to load'))
  useEffect(() => { load() }, [])

  const changed = () => { load(); useStore.getState().refreshConfig?.() }
  const post = async (path, body) => {
    setBusy(true)
    try { await api(path, { method: 'POST', body: JSON.stringify(body || {}) }); await load() }
    catch (e) { toast(e.message || 'Could not save push settings') }
    finally { setBusy(false) }
  }
  const openApns = () => openSheet(close => <ApnsSheet close={close} onDone={changed} current={d?.apns} />)
  const openFcm = () => openSheet(close => <FcmSheet close={close} onDone={changed} />)
  const openSubject = () => openSheet(close => <SubjectSheet close={close} onDone={changed} current={d?.web?.subject} />)
  const openKeys = () => openSheet(close => <VapidKeysSheet close={close} onDone={changed} />)
  const copyKey = () => {
    navigator.clipboard?.writeText(d?.web?.publicKey || '').catch(() => {})
    toast('Copied the public key')
  }
  const rotate = () => confirmSheet({
    title: 'Rotate the Web Push keys?',
    message: 'Every browser gets a new subscription on its next start. Until then, push notifications may not arrive. This cannot be undone.',
    confirmText: 'Rotate keys', danger: true,
    onConfirm: () => post('/api/admin/push/vapid', { rotate: true }),
  })
  const removeApns = () => confirmSheet({
    title: 'Remove the iPhone push credentials?',
    message: 'The server falls back to the APNs credentials from its environment, if any. Otherwise iPhones stop receiving server notifications until new credentials are added.',
    confirmText: 'Remove APNs', danger: true,
    onConfirm: () => post('/api/admin/push/apns/remove', {}),
  })
  const removeFcm = () => confirmSheet({
    title: 'Remove the Android push credentials?',
    message: 'The server falls back to the FCM credentials from its environment, if any. Otherwise Android phones stop receiving server notifications until new credentials are added.',
    confirmText: 'Remove FCM', danger: true,
    onConfirm: () => post('/api/admin/push/fcm/remove', {}),
  })
  const test = async () => {
    const devices = (d.devices?.web || 0) + (d.devices?.ios || 0) + (d.devices?.android || 0)
    if (!devices) { toast('No registered devices yet. Enable push on a device first.'); return }
    setBusy(true)
    try { await sendTestPush(); toast('Test sent! Should pop up any second') }
    catch (e) { toast(e.message || 'Test failed') }
    finally { setBusy(false) }
  }

  if (!d) return <div className="card">
    <h2 style={{ margin: 0 }}>Push notifications</h2>
    <div className="adm-lead" style={{ marginBottom: 0 }}>{err || 'Loading push settings…'}</div>
    {err && <div className="adm-actions"><Button size="sm" icon="reset" onClick={load}>Try again</Button></div>}
  </div>

  const webReady = !!d.web?.configured
  const iosReady = !!d.apns?.configured
  const androidReady = !!d.fcm?.configured
  const apnsEditable = d.apns?.source === 'dashboard' || d.apns?.source === 'unreadable'
  const fcmEditable = d.fcm?.source === 'dashboard' || d.fcm?.source === 'unreadable'

  return <div className="card">
    <div className="row between" style={{ marginBottom: 2 }}>
      <h2 style={{ margin: 0 }}>Push notifications</h2>
      <button className="iconbtn adm-iconbtn" onClick={load} aria-label="refresh push settings">↻</button>
    </div>
    <div className="adm-status">
      <span className={'adm-pill ' + (webReady ? 'ok' : 'warn')}>Web Push {webReady ? 'ready' : 'not ready'}</span>
      <span className={'adm-pill ' + (iosReady ? 'ok' : 'warn')}>iPhone {iosReady ? 'ready' : 'off'}</span>
      <span className={'adm-pill ' + (androidReady ? 'ok' : 'warn')}>Android {androidReady ? 'ready' : 'off'}</span>
    </div>
    <div className="adm-lead">
      Web Push works out of the box. Add credentials here to enable server notifications in the
      phone apps without a restart. Values set here override the server environment; removing
      them falls back to it.
    </div>

    {err && <div className="adm-result bad" style={{ marginBottom: 12 }}>
      <b>Could not refresh the push status</b>{err}
    </div>}

    <div className="adm-group-t">Web Push</div>
    <div className="adm-kv"><span className="k">Status</span><span className="v">
      <span className={'adm-pill ' + (webReady ? 'ok' : 'warn')}>{sourceLabel(d.web?.source)}</span>
    </span></div>
    {d.web?.publicKey && <div className="adm-kv"><span className="k">Public key</span><span className="v">
      <span style={{ fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', fontSize: 'var(--fs-caption2)', wordBreak: 'break-all' }}>{d.web.publicKey}</span>
      <button className="iconbtn adm-iconbtn" onClick={copyKey} aria-label="copy public key"><Icon name="copy" /></button>
    </span></div>}
    {env('Contact', d.web?.subject)}
    {d.web?.unreadable && <div className="adm-hint" style={{ color: 'var(--red)' }}>
      The stored Web Push key cannot be read. This usually means <code>./data</code> was restored
      without its <code>secret</code> file. Rotate the keys to fix it.
    </div>}
    <div className="adm-actions">
      <Button size="sm" icon="pencil" disabled={busy} onClick={openSubject}>Contact address</Button>
      <Button size="sm" variant="tinted" icon="reset" disabled={busy} onClick={rotate}>Rotate keys</Button>
      <Button size="sm" variant="tinted" icon="key" disabled={busy} onClick={openKeys}>Use my own keys</Button>
      {d.web?.source === 'dashboard' && <Button size="sm" variant="danger" icon="trash" disabled={busy}
        onClick={() => confirmSheet({
          title: 'Remove the dashboard Web Push override?',
          message: 'The server falls back to the generated keys in data/vapid.json. Browsers subscribed against the dashboard keys re-register on their next start.',
          confirmText: 'Remove override', danger: true,
          onConfirm: () => post('/api/admin/push/vapid/remove', {}),
        })}>Remove override</Button>}
    </div>

    <div className="adm-group-t" style={{ marginTop: 16 }}>iPhone (APNs)</div>
    <div className="adm-kv"><span className="k">Status</span><span className="v">
      <span className={'adm-pill ' + (iosReady ? 'ok' : 'warn') + ' ' + sourcePill(d.apns?.source)}>{sourceLabel(d.apns?.source)}</span>
    </span></div>
    {d.apns?.keyId && env('Key ID', d.apns.keyId)}
    {d.apns?.teamId && env('Team ID', d.apns.teamId)}
    {d.apns?.bundleId && env('Bundle ID', d.apns.bundleId)}
    {d.apns?.environment && env('Environment', d.apns.environment)}
    {d.apns?.updatedAt && env('Added', rel(d.apns.updatedAt))}
    {d.apns?.unreadable && <div className="adm-hint" style={{ color: 'var(--red)' }}>
      The stored APNs key cannot be read. Add it again to fix it.
    </div>}
    <div className="adm-hint">
      {d.apns?.source === 'environment'
        ? 'These are the APNs credentials from the server environment. Add your own here to override them.'
        : d.apns?.configured
          ? 'iPhones with the official app and the Server notifications switch on receive social and Coach alerts through APNs.'
          : 'Add an APNs Auth Key from your Apple Developer account to enable server notifications on iPhone.'}
    </div>
    <div className="adm-actions">
      <Button size="sm" variant={d.apns?.configured ? 'tinted' : 'primary'} icon="key" disabled={busy} onClick={openApns}>
        {d.apns?.configured ? 'Replace credentials' : 'Add credentials'}
      </Button>
      {apnsEditable && <Button size="sm" variant="danger" icon="trash" disabled={busy} onClick={removeApns}>Remove</Button>}
    </div>

    <div className="adm-group-t" style={{ marginTop: 16 }}>Android (FCM)</div>
    <div className="adm-kv"><span className="k">Status</span><span className="v">
      <span className={'adm-pill ' + (androidReady ? 'ok' : 'warn') + ' ' + sourcePill(d.fcm?.source)}>{sourceLabel(d.fcm?.source)}</span>
    </span></div>
    {d.fcm?.projectId && env('Project ID', d.fcm.projectId)}
    {d.fcm?.clientEmail && env('Client e-mail', d.fcm.clientEmail)}
    {d.fcm?.updatedAt && env('Added', rel(d.fcm.updatedAt))}
    {d.fcm?.unreadable && <div className="adm-hint" style={{ color: 'var(--red)' }}>
      The stored FCM credential cannot be read. Add the service account again to fix it.
    </div>}
    <div className="adm-hint">
      {d.fcm?.source === 'environment'
        ? 'These are the FCM credentials from the server environment. Add your own here to override them.'
        : d.fcm?.configured
          ? 'Android phones with the Play/APK build and the Server notifications switch on receive social and Coach alerts through FCM.'
          : 'Add a Firebase service-account JSON to enable server notifications on Android.'}
    </div>
    <div className="adm-actions">
      <Button size="sm" variant={d.fcm?.configured ? 'tinted' : 'primary'} icon="key" disabled={busy} onClick={openFcm}>
        {d.fcm?.configured ? 'Replace credentials' : 'Add credentials'}
      </Button>
      {fcmEditable && <Button size="sm" variant="danger" icon="trash" disabled={busy} onClick={removeFcm}>Remove</Button>}
    </div>

    <div className="adm-group-t" style={{ marginTop: 16 }}>Devices</div>
    <div className="tiles" style={{ textAlign: 'start', marginBottom: 10 }}>
      <div className="tile"><div className="l">Web</div><div className="v v-sm">{d.devices?.web ?? 0}</div></div>
      <div className="tile"><div className="l">iPhone</div><div className="v v-sm">{d.devices?.ios ?? 0}</div></div>
      <div className="tile"><div className="l">Android</div><div className="v v-sm">{d.devices?.android ?? 0}</div></div>
    </div>
    <div className="adm-hint">Send a notification to your own registered devices to check the setup. Enable push on this account in Settings → Reminders first.</div>
    <div className="adm-actions">
      <Button size="sm" icon="bell" disabled={busy} onClick={test}>Send test notification</Button>
    </div>
  </div>
}
