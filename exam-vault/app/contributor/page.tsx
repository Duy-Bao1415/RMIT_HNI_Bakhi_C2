'use client'
// Contributor: write-only. A question is encrypted IN THIS BROWSER with the bank's public
// key (encrypt only) and only ciphertext is sent to the server.
import { useCallback, useEffect, useState } from 'react'
import Shell from '@/components/Shell'
import { useApi, tideErrorText, fmtTime } from '@/lib/client'
import { bankSealer } from '@/lib/vault'
import { useTideCloak } from '@tidecloak/nextjs'
import { encryptFile, MAX_FILE_BYTES } from '@/lib/tide/files'

const EMPTY = { stem: '', A: '', B: '', C: '', D: '', answer: 'A', subject: 'Math', difficulty: 'Medium', topic: '', description: '' }
type Mode = 'mcq' | 'file'

export default function ContributorPage() {
  const api = useApi()
  const { token } = useTideCloak()
  const [f, setF] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: string; text: string } | null>(null)
  const [mine, setMine] = useState<any[]>([])
  const [bank, setBank] = useState<any[]>([])
  const [preview, setPreview] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [fileKey, setFileKey] = useState(0)
  const [mode, setMode] = useState<Mode>('mcq')

  const load = useCallback(async () => {
    try {
      const d = await api('/api/questions/mine')
      setMine(d.mine); setBank(d.bank)
    } catch (e) { setMsg({ kind: 'bad', text: tideErrorText(e) }) }
  }, [api])
  useEffect(() => { if (token) load() }, [token, load])

  const set = (k: keyof typeof EMPTY) => (e: any) => setF({ ...f, [k]: e.target.value })

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (mode === 'file' && !file) { setMsg({ kind: 'bad', text: 'Please choose a PDF or image file.' }); return }
    setBusy(true); setMsg(null); setPreview('')
    try {
      const seal = await bankSealer(api)
      const q = mode === 'mcq'
        ? { type: 'mcq', stem: f.stem, options: [f.A, f.B, f.C, f.D], answer: f.answer, subject: f.subject, difficulty: f.difficulty, topic: f.topic }
        : { type: 'file', stem: f.description, subject: f.subject, difficulty: f.difficulty, topic: f.topic }
      const ciphertext = await seal(JSON.stringify(q))
      // Encrypt the file too before anything is sent, so a failure sends nothing.
      const fileCt = mode === 'file' && file ? await encryptFile(file, seal) : null
      const { id } = await api('/api/questions', { method: 'POST', body: JSON.stringify({ ciphertext, subject: f.subject }) })
      let fileNote = ''
      if (file && fileCt) {
        const up = await api('/api/files', { method: 'POST', body: JSON.stringify({ question_id: id, file_name: file.name, mime: file.type, ciphertext: fileCt }) })
        fileNote = ` File “${file.name}” was encrypted and stored in S3 as ${up.key}.`
      }
      setPreview(ciphertext)
      setF({ ...EMPTY, subject: f.subject, difficulty: f.difficulty })
      setFile(null); setFileKey((k) => k + 1)
      setMsg({ kind: 'ok', text: `Question #${id} is locked in the bank. You will not be able to read it again.` + fileNote })
      load()
    } catch (err) {
      setMsg({ kind: 'bad', text: 'Could not submit: ' + tideErrorText(err) })
      api('/api/audit', { method: 'POST', body: JSON.stringify({ action: 'encrypt_attempt', target: 'question', result: 'denied' }) }).catch(() => {})
    } finally { setBusy(false) }
  }

  const total = bank.reduce((s, b) => s + b.count, 0)

  return (
    <Shell role="contributor" eyebrow="Lecturer workspace" title="Contribute questions to the bank"
      subtitle="Questions are encrypted in your browser before they are sent. You can WRITE (encrypt) but you cannot READ (decrypt) - not even your own questions.">
      <div className="stats">
        <div className="stat"><div className="k">My questions</div><div className="v">{mine.length}</div></div>
        <div className="stat"><div className="k">Questions in bank</div><div className="v">{total}</div></div>
        <div className="stat"><div className="k">Subjects</div><div className="v">{bank.length}</div></div>
      </div>
      <div className="grid-2 mt-lg">
        <form className="card" onSubmit={submit}>
          <div className="section-title"><span className="icon">✍️</span><h2>New question</h2></div>
          <label>Question type</label>
          <div className="segmented">
            <button type="button" className={mode === 'mcq' ? 'on' : ''} onClick={() => { setMode('mcq'); setMsg(null) }}>
              📝 Multiple choice<span>Question text, 4 options and the correct answer</span>
            </button>
            <button type="button" className={mode === 'file' ? 'on' : ''} onClick={() => { setMode('file'); setMsg(null) }}>
              📎 PDF / image<span>Upload a file, with an optional description</span>
            </button>
          </div>

          {mode === 'mcq' ? (
            <>
              <label>Question</label>
              <textarea required value={f.stem} onChange={set('stem')} placeholder="e.g. What is the derivative of x²?" />
              <div className="opts">
                {(['A', 'B', 'C', 'D'] as const).map((k) => (
                  <div key={k}><label>Option {k}</label><input required value={f[k]} onChange={set(k)} /></div>
                ))}
              </div>
              <div className="row">
                <div><label>Correct answer</label><select value={f.answer} onChange={set('answer')}>{['A', 'B', 'C', 'D'].map((k) => <option key={k}>{k}</option>)}</select></div>
              </div>
            </>
          ) : (
            <>
              <label>File (PDF or image)</label>
              <div className="dropzone">
                <input key={fileKey} type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                <div className="hint">{file ? `Selected: ${file.name} (${Math.round(file.size / 1024)} KB)` : `Max ${MAX_FILE_BYTES / 1024 / 1024} MB. Encrypted in your browser, stored in S3 as an opaque .bin object.`}</div>
              </div>
              <label>Description (optional)</label>
              <textarea value={f.description} onChange={set('description')} placeholder="e.g. Read the attached case study and answer questions 1-3." />
            </>
          )}

          <div className="row">
            <div><label>Subject</label><input required value={f.subject} onChange={set('subject')} /></div>
            <div><label>Difficulty</label><select value={f.difficulty} onChange={set('difficulty')}>{['Easy', 'Medium', 'Hard'].map((k) => <option key={k}>{k}</option>)}</select></div>
            <div><label>Topic</label><input value={f.topic} onChange={set('topic')} placeholder="optional" /></div>
          </div>
          <button className="mt-lg big" disabled={busy}>{busy ? 'Encrypting in your browser…' : '🔒 Encrypt & submit to bank'}</button>
          {msg && <div className={`note ${msg.kind}`}>{msg.text}</div>}
          {preview && (
            <div className="mt"><div className="muted" style={{ marginBottom: 6 }}>This is all the server received:</div><div className="cipher">{preview.slice(0, 360)}…</div></div>
          )}
        </form>
        <div className="stack">
          <div className="card">
            <div className="section-title"><span className="icon">🗂️</span><h2>Bank by subject</h2></div>
            <p className="muted">Counts only - nobody can browse the content.</p>
            {bank.length === 0 ? <p className="muted">No questions yet.</p> : (
              <div className="table-scroll"><table><thead><tr><th>Subject</th><th>Questions</th></tr></thead>
                <tbody>{bank.map((b) => <tr key={b.subject}><td>{b.subject}</td><td>{b.count}</td></tr>)}</tbody></table></div>
            )}
          </div>
          <div className="card">
            <div className="section-title"><span className="icon">🔒</span><h2>My submissions</h2></div>
            <p className="muted">Metadata only. Nobody, including you, can view the content again.</p>
            <div className="table-scroll"><table><thead><tr><th>ID</th><th>Subject</th><th>Submitted</th><th>Status</th></tr></thead>
              <tbody>
                {mine.length === 0 && <tr><td colSpan={4} className="muted">Nothing submitted yet.</td></tr>}
                {mine.map((q) => <tr key={q.id}><td>#{q.id}</td><td>{q.subject}</td><td>{fmtTime(q.created_at)}</td><td><span className="badge locked">Locked</span></td></tr>)}
              </tbody></table></div>
          </div>
        </div>
      </div>
    </Shell>
  )
}
