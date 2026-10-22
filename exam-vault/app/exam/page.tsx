'use client'
// Student: sees the exam only when the Tide network agrees to decrypt it for them, which
// requires the quorum-signed _tide_decryptor role. Decryption happens here, in the browser.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTideCloak } from '@tidecloak/nextjs'
import { IAMService } from '@tidecloak/js'
import Shell from '@/components/Shell'
import { useApi, tideErrorText, fmtTime } from '@/lib/client'
import { BANK_RECORD_ID, DECRYPT_ROLE } from '@/lib/tide/govern'
import { decryptFile } from '@/lib/tide/files'

const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

// Small seeded PRNG so each student's option order is stable (exam version) and re-derivable.
function rng(seed: string) {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19) }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296 }
}
const LETTERS = ['A', 'B', 'C', 'D']

interface Attachment { name: string; mime: string; url?: string; error?: string }
interface Q { id: number; type: 'mcq' | 'file'; stem: string; options: { letter: string; text: string }[]; subject?: string; attachments: Attachment[] }

function Countdown({ to }: { to: string }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  const ms = Math.max(0, new Date(to).getTime() - now)
  const h = Math.floor(ms / 3.6e6), m = Math.floor((ms % 3.6e6) / 6e4), s = Math.floor((ms % 6e4) / 1000)
  return <div className="countdown">{ms === 0 ? 'Exam time has started' : `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`}</div>
}

export default function ExamPage() {
  const api = useApi()
  const { token, forceRefreshToken, hasRealmRole, getValueFromIdToken } = useTideCloak()
  const [exams, setExams] = useState<any[]>([])
  const [sel, setSel] = useState<number | null>(null)
  const [questions, setQuestions] = useState<Q[] | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [state, setState] = useState<{ kind: string; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [clock, setClock] = useState(new Date())

  const load = useCallback(async () => {
    try {
      const d = await api('/api/exams')
      setExams(d.exams)
      setSel((s) => s ?? d.exams[0]?.id ?? null)
    } catch (e) { setState({ kind: 'bad', text: tideErrorText(e) }) }
  }, [api])
  useEffect(() => { if (token) load() }, [token, load])
  useEffect(() => { const t = setInterval(() => { setClock(new Date()); if (!questions) load() }, 10_000); return () => clearInterval(t) }, [load, questions])

  const exam = exams.find((e) => e.id === sel)

  const openExam = async () => {
    if (!exam) return
    setBusy(true); setState(null)
    try {
      // Pick up a freshly granted _tide_decryptor without logging out.
      await forceRefreshToken().catch(() => false)
      const d = await api(`/api/exams/${exam.id}`)
      const { policy_b64 } = await api('/api/policies?name=student-read')
      const plain = await IAMService.doDecrypt(
        d.items.map((i: any) => ({ encrypted: i.ciphertext, tags: [BANK_RECORD_ID] })),
        fromB64(policy_b64),
      )
      const qs: Q[] = d.items.map((item: any, idx: number) => {
        const raw = plain[idx]
        const q = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw))
        // Older questions carry no type; anything with options is multiple choice.
        const type: Q['type'] = q.type === 'file' || !Array.isArray(q.options) ? 'file' : 'mcq'
        let opts = type === 'mcq' ? q.options.map((text: string, i: number) => ({ letter: LETTERS[i], text })) : []
        if (type === 'mcq' && d.exam.num_versions > 1) {
          const r = rng(`${d.seed}:${item.id}`)
          opts = opts.map((o: any) => [r(), o]).sort((a: any, b: any) => a[0] - b[0]).map((x: any) => x[1])
        }
        return { id: item.id, type, stem: q.stem ?? '', options: opts, subject: q.subject, attachments: [] }
      })
      // Attachments: fetch ciphertext from S3 (via our API), decrypt here, show as blob URLs.
      for (const [idx, item] of d.items.entries()) {
        for (const a of item.attachments ?? []) {
          try {
            const f = await api(`/api/files/${a.id}`)
            const blob = await decryptFile(f.ciphertext, policy_b64, f.mime)
            qs[idx].attachments.push({ name: f.file_name, mime: f.mime, url: URL.createObjectURL(blob) })
          } catch (err) {
            qs[idx].attachments.push({ name: a.file_name, mime: a.mime, error: tideErrorText(err) })
          }
        }
      }
      setQuestions(qs)
      setAnswers(d.submission?.answers ?? {})
      api('/api/audit', { method: 'POST', body: JSON.stringify({ action: 'decrypt_attempt', target: `exam#${exam.id}`, result: 'success' }) }).catch(() => {})
    } catch (e) {
      const text = tideErrorText(e)
      setState({ kind: 'bad', text: text.includes('not open') ? 'The exam is not open yet.' : `The exam is not open for you - the Tide network refused to decrypt. (${text})` })
      api('/api/audit', { method: 'POST', body: JSON.stringify({ action: 'decrypt_attempt', target: `exam#${exam.id}`, result: 'denied' }) }).catch(() => {})
    } finally { setBusy(false) }
  }

  const submit = async () => {
    if (!exam) return
    try {
      await api(`/api/exams/${exam.id}/submit`, { method: 'POST', body: JSON.stringify({ answers }) })
      setState({ kind: 'ok', text: `Submitted at ${fmtTime(new Date())}.` })
    } catch (e) { setState({ kind: 'bad', text: tideErrorText(e) }) }
  }

  const username = getValueFromIdToken('preferred_username')
  const fullName = [getValueFromIdToken('given_name'), getValueFromIdToken('family_name')].filter(Boolean).join(' ') || username
  const mark = `${fullName} · ${username} · ${clock.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
  const marks = useMemo(() => Array.from({ length: 60 }, (_, i) => <span key={i}>{mark}</span>), [mark])
  const hasDecryptor = hasRealmRole(DECRYPT_ROLE)
  const answered = questions ? questions.filter((q) => answers[q.id]).length : 0

  return (
    <Shell role="student" eyebrow="Exam room" title={exam && questions ? exam.title : 'Your exams'}
      subtitle="The exam is decrypted on your device, and only once the committee has signed on the Tide network.">
      {exams.length === 0 && <div className="card muted">You are not registered for any exam.</div>}
      {exams.length > 1 && !questions && (
        <div className="card"><label style={{ marginTop: 0 }}>Choose an exam</label>
          <select value={sel ?? ''} onChange={(e) => { setSel(+e.target.value); setQuestions(null) }}>
            {exams.map((e) => <option key={e.id} value={e.id}>#{e.id} {e.title}</option>)}
          </select></div>
      )}
      {exam && !questions && (
        <div className="card">
          <div className="lock-screen">
            <div className="lock-icon">{exam.status === 'open' ? '🔓' : '🔒'}</div>
            <span className={`badge ${exam.status}`}>{exam.status.toUpperCase()}</span>
            <h2 style={{ margin: 0 }}>{exam.title}</h2>
            <div className="muted">{exam.subject} · starts {fmtTime(exam.start_time)} · {exam.duration_min} min</div>
            {exam.status !== 'open' && <><div className="muted mt">The exam is not open yet. Starts in</div><Countdown to={exam.start_time} /></>}
            <div style={{ width: 'min(360px, 100%)' }} className="mt">
              <div className="muted">Committee approvals: <b>{exam.open_count}/{exam.quorum}</b></div>
              <div className="progress"><div style={{ width: `${Math.min(100, (exam.open_count / exam.quorum) * 100)}%` }} /></div>
            </div>
            <div className="muted">Tide decryption right (<code>{DECRYPT_ROLE}</code>) on your session: <b style={{ color: hasDecryptor ? 'var(--ok)' : 'var(--bad)' }}>{hasDecryptor ? 'GRANTED' : 'NOT YET'}</b></div>
            <button className="big mt" disabled={busy} onClick={openExam}>{busy ? 'Decrypting in your browser…' : 'Enter exam'}</button>
            {state && <div className={`note ${state.kind}`}>{state.text}</div>}
          </div>
        </div>
      )}
      {exam && questions && (
        <div className="card exam-sheet">
          <div className="watermark" aria-hidden>{marks}</div>
          <div className="card-head" style={{ position: 'relative', zIndex: 1 }}>
            <div className="muted">{questions.length} questions · personal version for <b>{username}</b></div>
            <span className="badge open">{answered}/{questions.length} answered</span>
          </div>
          <div className="progress" style={{ position: 'relative', zIndex: 1 }}><div style={{ width: `${(answered / Math.max(1, questions.length)) * 100}%` }} /></div>
          {questions.map((q, i) => (
            <div className="q" key={q.id}>
              <span className="q-num">Question {i + 1}</span>{q.type === 'file' && <span className="tag">FILE</span>}
              {q.stem && <div className="stem">{q.stem}</div>}
              {q.attachments.map((a, k) => (
                <div key={k} className="mt">
                  {a.error ? <div className="note bad">Could not decrypt {a.name}: {a.error}</div>
                    : a.mime.startsWith('image/') ? <img src={a.url} alt={a.name} style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid var(--line)' }} />
                    : a.mime === 'application/pdf' ? <iframe src={a.url} title={a.name} style={{ width: '100%', height: 420, border: '1px solid var(--line)', borderRadius: 8 }} />
                    : <a href={a.url} download={a.name}>Download {a.name}</a>}
                </div>
              ))}
              {q.type === 'file' && (
                <div className="mt">
                  <label>Your answer</label>
                  <textarea value={answers[q.id] ?? ''} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} placeholder="Write your answer here…" />
                </div>
              )}
              {q.options.map((o, j) => (
                <label className={`opt ${answers[q.id] === o.letter ? 'sel' : ''}`} key={o.letter}>
                  <input type="radio" name={`q${q.id}`} checked={answers[q.id] === o.letter} onChange={() => setAnswers({ ...answers, [q.id]: o.letter })} />
                  <span><b>{LETTERS[j]}.</b> {o.text}</span>
                </label>
              ))}
            </div>
          ))}
          <div style={{ position: 'relative', zIndex: 1 }}>
            <button className="mt-lg big" onClick={submit}>Submit answers</button>
            {state && <div className={`note ${state.kind}`}>{state.text}</div>}
          </div>
        </div>
      )}
    </Shell>
  )
}
