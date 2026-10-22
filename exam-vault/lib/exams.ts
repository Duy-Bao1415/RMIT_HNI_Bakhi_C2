// Exam lifecycle helpers (server only). Drawing works on question IDs and ciphertext:
// the server picks the exam without being able to read a single question.
import { randomInt, createHash } from 'crypto'
import { sql } from './db'

export const QUORUM = Number(process.env.NEXT_PUBLIC_QUORUM || 3)

export async function examWithProgress(id: number) {
  const [exam] = await sql('SELECT * FROM exams WHERE id = $1', [id])
  if (!exam) return null
  const approvals = await sql('SELECT committee_id, action, approved_at FROM approvals WHERE exam_id = $1 ORDER BY approved_at', [id])
  const students = (await sql<{ student_id: string }>('SELECT student_id FROM exam_students WHERE exam_id = $1 ORDER BY student_id', [id])).map((s) => s.student_id)
  return {
    ...exam,
    students,
    approvals,
    open_count: approvals.filter((a: any) => a.action === 'open').length,
    close_count: approvals.filter((a: any) => a.action === 'close').length,
    quorum: QUORUM,
  }
}

/** Fisher-Yates with crypto.randomInt: pick n question ids of the subject. */
export async function drawQuestions(examId: number, subject: string, n: number) {
  const ids = (await sql<{ id: number }>('SELECT id FROM questions WHERE subject = $1', [subject])).map((r) => r.id)
  for (let i = ids.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
  }
  const picked = ids.slice(0, Math.min(n, ids.length))
  await sql('UPDATE exams SET question_ids = $2 WHERE id = $1', [examId, picked])
  return picked
}

/** Deterministic per-student permutation (exam version), reproducible at grading time. */
export function seededOrder<T>(items: T[], seed: string): T[] {
  let state = createHash('sha256').update(seed).digest()
  let k = 0
  const next = () => {
    if (k + 4 > state.length) { state = createHash('sha256').update(state).digest(); k = 0 }
    const v = state.readUInt32BE(k); k += 4; return v
  }
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = next() % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** Status the clock implies for an exam that the quorum has opened. */
export function effectiveStatus(exam: any): string {
  if (exam.status === 'open') {
    const end = new Date(exam.start_time).getTime() + exam.duration_min * 60_000
    if (Date.now() > end) return 'closed'
  }
  return exam.status
}
