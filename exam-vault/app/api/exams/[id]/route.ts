import { NextRequest, NextResponse } from 'next/server'
import { authorize, isResponse } from '@/lib/auth'
import { sql, audit } from '@/lib/db'
import { effectiveStatus, seededOrder } from '@/lib/exams'

// A student fetches the CIPHERTEXT of their exam version. Decryption happens in their
// browser and only succeeds if the Tide network agrees (quorum-granted _tide_decryptor).
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const caller = await authorize(req, ['student'], 'fetch_exam')
  if (isResponse(caller)) return caller
  const id = Number((await ctx.params).id)
  const [exam] = await sql('SELECT * FROM exams WHERE id = $1', [id])
  if (!exam) return NextResponse.json({ error: 'Exam not found' }, { status: 404 })
  const [enrolled] = await sql('SELECT 1 FROM exam_students WHERE exam_id = $1 AND student_id = $2', [id, caller.username])
  if (!enrolled) {
    await audit(caller.username, caller.role, 'fetch_exam', `exam#${id}`, 'denied')
    return NextResponse.json({ error: 'You are not registered for this exam' }, { status: 403 })
  }
  const status = effectiveStatus(exam)
  if (status !== 'open') {
    return NextResponse.json({ error: 'The exam is not open yet', status }, { status: 423 })
  }
  const rows = await sql(
    `SELECT q.id, q.ciphertext,
            COALESCE(json_agg(json_build_object('id', f.id, 'file_name', f.file_name, 'mime', f.mime))
                     FILTER (WHERE f.id IS NOT NULL), '[]') AS attachments
     FROM questions q LEFT JOIN files f ON f.question_id = q.id
     WHERE q.id = ANY($1::int[]) GROUP BY q.id`,
    [exam.question_ids],
  )
  // Exam version: question order depends on hash(exam, student) when num_versions > 1.
  const seed = `${id}:${exam.num_versions > 1 ? caller.username : 'v1'}`
  const items = seededOrder(rows, seed)
  const [sub] = await sql('SELECT answers, submitted_at FROM submissions WHERE exam_id = $1 AND student_id = $2', [id, caller.username])
  await audit(caller.username, caller.role, 'fetch_exam', `exam#${id}`, 'success')
  return NextResponse.json({
    exam: { id, title: exam.title, subject: exam.subject, start_time: exam.start_time, duration_min: exam.duration_min, num_versions: exam.num_versions },
    seed,
    items,
    submission: sub ?? null,
  })
}
