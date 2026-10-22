'use client'
// Committee: create exams, vote to open/close, and - the part that actually matters -
// co-sign the Tide change requests that grant students _tide_decryptor.
import { useCallback, useEffect, useState } from 'react'
import { useTideCloak } from '@tidecloak/nextjs'
import Shell from '@/components/Shell'
import { useApi, tideErrorText, fmtTime } from '@/lib/client'
import { signRelationshipPolicy } from '@/lib/tide/relationship'
import {
  BANK_RECORD_ID, VENDOR_ID, approveRequests, decryptorRequestsFor, fetchAdminPolicy,
  findUserId, holdersOfDecryptor, listPending, requestDecryptorChange, type ChangeRequest,
} from '@/lib/tide/govern'
import AuditTable from '@/components/AuditTable'
import { displayName } from '@/lib/names'

const POLICIES = [
  { name: 'contributor-write', label: 'Lecturers may only ENCRYPT', subject: { type: 'Role', id: 'contributor' } as const, access: 'write' as const },
  { name: 'student-read', label: 'Students may only DECRYPT (once they hold _tide_decryptor)', subject: { type: 'Role', id: 'student' } as const, access: 'read' as const },
]
const STAGES = ['locked', 'pending', 'open', 'closed']

function localInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function Lifecycle({ status }: { status: string }) {
  const at = STAGES.indexOf(status)
  return (
    <div className="stepper">
      {STAGES.map((s, i) => (
        <div key={s} className={`step ${i < at ? 'done' : ''} ${i === at ? 'done current' : ''}`}>{s[0].toUpperCase() + s.slice(1)}</div>
      ))}
    </div>
  )
}

export default function CommitteePage() {
  const api = useApi()
  const { token, getValueFromIdToken, hasClientRole } = useTideCloak()
  const me = getValueFromIdToken('preferred_username')
  // Only tide-realm-admins can sign governance requests in the Tide enclave.
  const isTideAdmin = hasClientRole('tide-realm-admin', 'realm-management')
  const [exams, setExams] = useState<any[]>([])
  const [policies, setPolicies] = useState<any[]>([])
  const [pending, setPending] = useState<ChangeRequest[]>([])
  const [userIds, setUserIds] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<Record<string, { kind: string; text: string }>>({})
  const [busy, setBusy] = useState('')
  const [form, setForm] = useState({
    title: 'Calculus I - Midterm', subject: 'Math', start_time: localInput(new Date(Date.now() + 10 * 60_000)),
    duration_min: 60, num_questions: 5, num_versions: 2, students: 'student1',
  })
  const [auditKey, setAuditKey] = useState(0)

  const note = (k: string, kind: string, text: string) => setMsg((m) => ({ ...m, [k]: { kind, text } }))

  const load = useCallback(async () => {
    try {
      const [e, p] = await Promise.all([api('/api/exams'), api('/api/policies')])
      setExams(e.exams); setPolicies(p.policies)
      const names = Array.from(new Set<string>(e.exams.flatMap((x: any) => x.students)))
      const ids: Record<string, string> = {}
      for (const n of names) { try { ids[n] = await findUserId(token!, n) } catch { /* not in realm */ } }
      setUserIds(ids)
      try { setPending(await listPending(token!)) } catch (err) { note('tide', 'warn', 'Could not read change requests from TideCloak: ' + tideErrorText(err)) }
    } catch (err) { note('page', 'bad', tideErrorText(err)) }
    setAuditKey((k) => k + 1)
  }, [api, token])
  useEffect(() => { if (token) load() }, [token, load])

  const signPolicy = async (p: (typeof POLICIES)[number]) => {
    setBusy(p.name)
    try {
      const adminPolicy = await fetchAdminPolicy(token!)
      const signed = await signRelationshipPolicy({ vendorId: VENDOR_ID, subject: p.subject, recordId: BANK_RECORD_ID, access: p.access }, adminPolicy)
      await api('/api/policies', { method: 'POST', body: JSON.stringify({ name: p.name, policy: signed }) })
      note('setup', 'ok', `Policy “${p.name}” was signed by the Tide network.`)
      load()
    } catch (err) { note('setup', 'bad', `Signing ${p.name} failed: ${tideErrorText(err)}`) }
    finally { setBusy('') }
  }

  const createExam = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await api('/api/exams', { method: 'POST', body: JSON.stringify({ ...form, start_time: new Date(form.start_time).toISOString() }) })
      note('create', 'ok', 'Exam created (status: locked).')
      load()
    } catch (err) { note('create', 'bad', tideErrorText(err)) }
  }

  /** Vote in the app AND co-sign the Tide change requests for this exam's students. */
  const vote = async (exam: any, action: 'open' | 'close') => {
    const key = `exam-${exam.id}`
    setBusy(key)
    const lines: string[] = []
    try {
      const r = await api(`/api/exams/${exam.id}/approve`, { method: 'POST', body: JSON.stringify({ action }) })
      lines.push(`Your vote is recorded: ${r.count}/${r.quorum} (${r.status}${r.drawn ? `, ${r.drawn} questions drawn` : ''}).`)
    } catch (err) { lines.push('App vote: ' + tideErrorText(err)) }
    if (!isTideAdmin) {
      note(key, 'ok', lines.join(' ') + ' The Tide signature that grants students decryption is given by the committee chair (tide-realm-admin).')
      setBusy(''); load(); return
    }
    try {
      const ids = exam.students.map((s: string) => userIds[s]).filter(Boolean)
      let crs = decryptorRequestsFor(await listPending(token!), ids)
      // Only file a request for students whose access actually needs to change.
      const holders = await holdersOfDecryptor(token!, exam.students)
      const needChange = exam.students.filter((s: string) => (action === 'open') !== holders.includes(s))
      if (crs.length === 0 && needChange.length === 0) {
        lines.push(`Tide: students already ${action === 'open' ? 'hold' : 'lack'} _tide_decryptor - nothing to sign.`)
      } else if (crs.length === 0) {
        const filed = await requestDecryptorChange(token!, needChange, action === 'open')
        lines.push(`Tide: filed a request to ${action === 'open' ? 'grant' : 'revoke'} _tide_decryptor → ` + filed.map((f) => `${f.username}: ${f.note}`).join('; '))
        await api('/api/audit', { method: 'POST', body: JSON.stringify({ action: 'tide_grant_request', target: `exam#${exam.id} ${action}`, result: 'success' }) })
        crs = decryptorRequestsFor(await listPending(token!), ids)
      }
      if (crs.length) {
        const res = await approveRequests(token!, crs.map((c) => c.id))
        const summary = Object.values(res).map((v: any) => v.error ? `error ${v.error}` : `${v.committed ? 'APPLIED' : 'signed'} ${v.authCount ?? '?'}/${v.threshold ?? '?'}`).join('; ')
        lines.push('Tide: your signature → ' + summary)
        await api('/api/audit', { method: 'POST', body: JSON.stringify({ action: 'tide_approve', target: `exam#${exam.id} ${action}: ${summary}`, result: summary.includes('error') ? 'denied' : 'success' }) })
      }
      note(key, 'ok', lines.join(' '))
    } catch (err) {
      lines.push('Tide: ' + tideErrorText(err))
      note(key, 'warn', lines.join(' '))
    } finally { setBusy(''); load() }
  }

  const signed = (name: string) => policies.find((p) => p.name === name)
  const openCount = exams.filter((x) => x.status === 'open').length

  return (
    <Shell role="committee" eyebrow="Exam committee" title="Committee console"
      subtitle="No single member can open an exam. Students only receive decryption rights once enough committee members have signed in the Tide enclave.">
      {msg.page && <div className={`note ${msg.page.kind}`}>{msg.page.text}</div>}

      <div className="stats">
        <div className="stat"><div className="k">Exams</div><div className="v">{exams.length}</div></div>
        <div className="stat"><div className="k">Open now</div><div className="v">{openCount}</div></div>
        <div className="stat"><div className="k">Pending Tide requests</div><div className="v">{pending.length}</div></div>
        <div className="stat"><div className="k">Policies signed</div><div className="v">{policies.length}/{POLICIES.length}</div></div>
      </div>

      <div className="card mt-lg">
        <div className="card-head">
          <div className="section-title"><span className="icon">🛡️</span><h2>Exam bank setup (one-time)</h2></div>
          <span className="muted">Built-in contract <code>RelationshipAttestation:1</code> · tag <code>{BANK_RECORD_ID}</code></span>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>Only a <b>tide-realm-admin</b> can sign these. Signing opens the Tide enclave in a popup.</p>
        <div className="table-scroll"><table><tbody>{POLICIES.map((p) => (
          <tr key={p.name}>
            <td><b>{p.name}</b><div className="muted">{p.label}</div></td>
            <td>{signed(p.name) ? <span className="badge success">Signed by {displayName(signed(p.name).granted_by)}</span> : <span className="badge pending">Not signed</span>}</td>
            <td style={{ textAlign: 'right' }}><button className="ghost" disabled={!!busy} onClick={() => signPolicy(p)}>{busy === p.name ? 'Opening enclave…' : signed(p.name) ? 'Re-sign' : 'Sign policy'}</button></td>
          </tr>))}</tbody></table></div>
        {msg.setup && <div className={`note ${msg.setup.kind}`}>{msg.setup.text}</div>}
      </div>

      <div className="grid-2 mt-lg">
        <div className="stack">
          {exams.length === 0 && <div className="card muted">No exams yet - create one on the right.</div>}
          {exams.map((x) => {
            const ids = x.students.map((s: string) => userIds[s]).filter(Boolean)
            const crs = decryptorRequestsFor(pending, ids)
            const iVotedOpen = x.approvals.some((a: any) => a.committee_id === me && a.action === 'open')
            const iVotedClose = x.approvals.some((a: any) => a.committee_id === me && a.action === 'close')
            const closing = x.status === 'open' || x.status === 'closed'
            const count = closing ? x.close_count : x.open_count
            const voters = x.approvals.filter((a: any) => a.action === (closing ? 'close' : 'open')).map((a: any) => displayName(a.committee_id))
            return (
              <div className="card" key={x.id}>
                <div className="card-head">
                  <h2>#{x.id} · {x.title}</h2>
                  <span className={`badge ${x.status}`}>{x.status.toUpperCase()}</span>
                </div>
                <div className="muted">{x.subject} · starts {fmtTime(x.start_time)} · {x.duration_min} min · {x.num_questions} questions · {x.num_versions} versions</div>
                <div className="muted">Students: {x.students.join(', ')}</div>
                <Lifecycle status={x.status} />
                <div className="row" style={{ alignItems: 'center' }}>
                  <div><b>{closing ? 'Close approvals' : 'Open approvals'}: {count}/{x.quorum}</b> <span className="muted">{voters.length ? `(${voters.join(', ')})` : ''}</span>
                    <div className="progress"><div style={{ width: `${Math.min(100, (count / x.quorum) * 100)}%` }} /></div></div>
                </div>
                <div className="note info">
                  <b>Tide gate:</b>{' '}
                  {crs.length === 0 ? 'no pending change request for this exam’s students.' :
                    crs.map((c) => `${c.actionType} · ${c.authorizationCount ?? 0}/${c.threshold ?? '?'} signatures${c.authorizers?.length ? ' (' + c.authorizers.map((a) => displayName(a.username)).join(', ') + ')' : ''}`).join(' · ')}
                </div>
                <div className="row mt">
                  {['locked', 'pending'].includes(x.status) && (
                    <button disabled={!!busy || iVotedOpen} onClick={() => vote(x, 'open')}>{iVotedOpen ? '✓ You approved opening' : busy === `exam-${x.id}` ? 'Signing…' : 'Approve opening'}</button>
                  )}
                  {x.status === 'open' && (
                    <button className="ghost" disabled={!!busy || iVotedClose} onClick={() => vote(x, 'close')}>{iVotedClose ? '✓ You approved closing' : 'Approve closing'}</button>
                  )}
                  {x.status === 'closed' && crs.length > 0 && (
                    <button className="ghost" disabled={!!busy} onClick={() => vote(x, 'close')}>Sign decrypt-rights removal</button>
                  )}
                </div>
                {msg[`exam-${x.id}`] && <div className={`note ${msg[`exam-${x.id}`].kind}`}>{msg[`exam-${x.id}`].text}</div>}
              </div>
            )
          })}
          {msg.tide && <div className={`note ${msg.tide.kind}`}>{msg.tide.text}</div>}
        </div>

        <form className="card" onSubmit={createExam}>
          <div className="section-title"><span className="icon">🗓️</span><h2>Create exam</h2></div>
          <label>Title</label><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          <div className="row">
            <div><label>Subject</label><input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} required /></div>
            <div><label>Starts at</label><input type="datetime-local" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} required /></div>
          </div>
          <div className="row">
            <div><label>Duration (min)</label><input type="number" value={form.duration_min} onChange={(e) => setForm({ ...form, duration_min: +e.target.value })} /></div>
            <div><label>Questions</label><input type="number" value={form.num_questions} onChange={(e) => setForm({ ...form, num_questions: +e.target.value })} /></div>
            <div><label>Versions</label><input type="number" value={form.num_versions} onChange={(e) => setForm({ ...form, num_versions: +e.target.value })} /></div>
          </div>
          <label>Students (usernames, comma separated)</label>
          <input value={form.students} onChange={(e) => setForm({ ...form, students: e.target.value })} required />
          <button className="mt-lg">Create exam</button>
          {msg.create && <div className={`note ${msg.create.kind}`}>{msg.create.text}</div>}
        </form>
      </div>

      <AuditTable refreshKey={auditKey} />
    </Shell>
  )
}
