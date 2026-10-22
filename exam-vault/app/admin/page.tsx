'use client'
// IT admin: full access to the database and the bucket - and still cannot read a single
// question, open an exam, or grant themselves decryption.
import { useCallback, useEffect, useState } from 'react'
import { useTideCloak } from '@tidecloak/nextjs'
import Shell from '@/components/Shell'
import AuditTable from '@/components/AuditTable'
import { useApi, tideErrorText, fmtTime } from '@/lib/client'
import { decryptFile } from '@/lib/tide/files'
import { bankOpener } from '@/lib/vault'
import { approveRequests, decryptorRequestsFor, findUserId, listPending, requestDecryptorChange } from '@/lib/tide/govern'

export default function AdminPage() {
  const api = useApi()
  const { token, getValueFromIdToken } = useTideCloak()
  const me = getValueFromIdToken('preferred_username')
  const [raw, setRaw] = useState<{ questions: any[]; exams: any[]; files: any[]; bucket: any[]; bucketError?: string }>({ questions: [], exams: [], files: [], bucket: [] })
  const [msg, setMsg] = useState<Record<string, { kind: string; text: string }>>({})
  const [auditKey, setAuditKey] = useState(0)
  const note = (k: string, kind: string, text: string) => { setMsg((m) => ({ ...m, [k]: { kind, text } })); setAuditKey((x) => x + 1) }

  const load = useCallback(async () => {
    try { setRaw(await api('/api/admin/raw')) } catch (e) { note('page', 'bad', tideErrorText(e)) }
  }, [api])
  useEffect(() => { if (token) load() }, [token, load])

  const tryDecrypt = async (q: any) => {
    try {
      const pt = await bankOpener(api)(q.ciphertext)
      note(`q${q.id}`, 'warn', 'DECRYPTED (unexpected!): ' + pt.slice(0, 80))
    } catch (e) {
      note(`q${q.id}`, 'bad', 'Denied: you have no decryption right. ' + tideErrorText(e))
      api('/api/audit', { method: 'POST', body: JSON.stringify({ action: 'decrypt_attempt', target: `question#${q.id}`, result: 'denied' }) }).catch(() => {})
    }
  }

  const tryOpenFile = async (f: any) => {
    try {
      const d = await api(`/api/files/${f.id}`)
      await decryptFile(d.ciphertext, bankOpener(api), d.mime)
      note(`f${f.id}`, 'warn', 'FILE OPENED (unexpected!)')
    } catch (e) {
      note(`f${f.id}`, 'bad', 'Denied: the ciphertext was downloaded from S3 but cannot be decrypted. ' + tideErrorText(e))
      api('/api/audit', { method: 'POST', body: JSON.stringify({ action: 'decrypt_attempt', target: `file#${f.id}`, result: 'denied' }) }).catch(() => {})
    }
  }

  const selfGrant = async () => {
    const lines: string[] = []
    try {
      const filed = await requestDecryptorChange(token!, [me], true)
      lines.push('Assign _tide_decryptor to myself → ' + filed.map((f) => `HTTP ${f.status}: ${f.note}`).join('; ') + '.')
      const myId = await findUserId(token!, me)
      const crs = decryptorRequestsFor(await listPending(token!), [myId])
      if (crs.length) {
        const res = await approveRequests(token!, crs.map((c) => c.id))
        lines.push('Approve my own request → ' + Object.values(res).map((v: any) => v.error ? `DENIED (${v.error})` : `${v.authCount}/${v.threshold}`).join('; ') + '.')
      }
      note('grant', 'bad', lines.join(' ') + ' The right was NOT granted: the committee (tide-realm-admin) must sign in the Tide enclave.')
    } catch (e) {
      lines.push('Denied: ' + tideErrorText(e))
      note('grant', 'bad', lines.join(' '))
    }
    api('/api/audit', { method: 'POST', body: JSON.stringify({ action: 'self_grant_attempt', target: `${me} → _tide_decryptor`, result: 'denied' }) }).catch(() => {})
  }

  const forceOpen = async (id: number) => {
    try { await api(`/api/exams/${id}/force-open`, { method: 'POST' }); note(`e${id}`, 'warn', 'Opened (unexpected!)') }
    catch (e) { note(`e${id}`, 'bad', tideErrorText(e)) }
  }

  return (
    <Shell role="admin" eyebrow="IT administration" title="What the admin can actually see"
      subtitle="You have full access to the database, the storage bucket and user management. This is everything you get.">
      {msg.page && <div className={`note ${msg.page.kind}`}>{msg.page.text}</div>}

      <div className="stats">
        <div className="stat"><div className="k">Encrypted questions</div><div className="v">{raw.questions.length}</div></div>
        <div className="stat"><div className="k">Encrypted files</div><div className="v">{raw.files.length}</div></div>
        <div className="stat"><div className="k">Exams</div><div className="v">{raw.exams.length}</div></div>
        <div className="stat"><div className="k">Readable by you</div><div className="v" style={{ color: 'var(--bad)' }}>0</div></div>
      </div>

      <div className="card mt-lg">
        <div className="card-head">
          <div className="section-title"><span className="icon">🗄️</span><h2>Table <code>questions</code> - raw database rows</h2></div>
          <span className="muted">Exactly what Neon, the cloud, or anyone with a DB dump sees</span>
        </div>
        <div className="table-scroll"><table>
          <thead><tr><th>ID</th><th>Author</th><th>Subject</th><th>Ciphertext</th><th></th></tr></thead>
          <tbody>
            {raw.questions.length === 0 && <tr><td colSpan={5} className="muted">No questions yet.</td></tr>}
            {raw.questions.map((q) => (
              <tr key={q.id}>
                <td>#{q.id}</td><td>{q.author_name}</td><td>{q.subject}</td>
                <td style={{ maxWidth: 460 }}><div className="cipher">{q.ciphertext.slice(0, 180)}…</div>
                  {msg[`q${q.id}`] && <div className={`note ${msg[`q${q.id}`].kind}`}>{msg[`q${q.id}`].text}</div>}</td>
                <td><button className="ghost" onClick={() => tryDecrypt(q)}>Try to decrypt</button></td>
              </tr>))}
          </tbody>
        </table></div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="section-title"><span className="icon">🪣</span><h2>S3 bucket - attachments</h2></div>
          <span className="muted">Every object is <code>exam-files/&lt;uuid&gt;.bin</code> - no name, no format</span>
        </div>
        {raw.bucketError && <div className="note warn">{raw.bucketError}</div>}
        <div className="table-scroll"><table>
          <thead><tr><th>File</th><th>Question</th><th>S3 object</th><th>Size</th><th></th></tr></thead>
          <tbody>
            {raw.files.length === 0 && <tr><td colSpan={5} className="muted">No attachments yet.</td></tr>}
            {raw.files.map((f) => (
              <tr key={f.id}>
                <td>#{f.id} {f.file_name}</td><td>#{f.question_id}</td><td className="mono">{f.s3_key}
                  {msg[`f${f.id}`] && <div className={`note ${msg[`f${f.id}`].kind}`}>{msg[`f${f.id}`].text}</div>}</td>
                <td>{Math.round(f.size / 1024)} KB</td>
                <td><button className="ghost" onClick={() => tryOpenFile(f)}>Try to open</button></td>
              </tr>))}
          </tbody>
        </table></div>
        {raw.bucket.length > 0 && <p className="muted mt">Listed directly from the bucket: {raw.bucket.length} object(s) - {raw.bucket.slice(0, 3).map((o) => o.key).join(', ')}{raw.bucket.length > 3 ? ', …' : ''}</p>}
      </div>

      <div className="grid mt-lg">
        <div className="card">
          <div className="section-title"><span className="icon">🔑</span><h2>Grant myself decryption</h2></div>
          <p className="muted">As the user manager, try to assign the <code>_tide_decryptor</code> role to yourself through the TideCloak admin API.</p>
          <button className="danger" onClick={selfGrant}>Self-grant _tide_decryptor</button>
          {msg.grant && <div className={`note ${msg.grant.kind}`}>{msg.grant.text}</div>}
        </div>
        <div className="card">
          <div className="section-title"><span className="icon">⚡</span><h2>Force open (bypass the committee)</h2></div>
          {raw.exams.length === 0 && <p className="muted">No exams yet.</p>}
          {raw.exams.map((e) => (
            <div key={e.id} className="mt">
              <div className="row" style={{ alignItems: 'center' }}>
                <div>#{e.id} {e.title} <span className={`badge ${e.status}`}>{e.status}</span><div className="muted">{fmtTime(e.start_time)}</div></div>
                <button className="danger" style={{ flex: 'none' }} onClick={() => forceOpen(e.id)}>Force open</button>
              </div>
              {msg[`e${e.id}`] && <div className={`note ${msg[`e${e.id}`].kind}`}>{msg[`e${e.id}`].text}</div>}
            </div>
          ))}
        </div>
      </div>
      <AuditTable refreshKey={auditKey} />
    </Shell>
  )
}
