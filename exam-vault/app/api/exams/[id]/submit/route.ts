import { NextRequest, NextResponse } from 'next/server'
import { authorize, isResponse } from '@/lib/auth'
import { sql, audit } from '@/lib/db'
import { effectiveStatus } from '@/lib/exams'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const caller = await authorize(req, ['student'], 'submit_exam')
  if (isResponse(caller)) return caller
  const id = Number((await ctx.params).id)
  const [exam] = await sql('SELECT * FROM exams WHERE id = $1', [id])
  const [enrolled] = await sql('SELECT 1 FROM exam_students WHERE exam_id = $1 AND student_id = $2', [id, caller.username])
  if (!exam || !enrolled) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (effectiveStatus(exam) !== 'open') return NextResponse.json({ error: 'The exam is not open' }, { status: 409 })
  const { answers } = await req.json()
  if (!answers || typeof answers !== 'object') return NextResponse.json({ error: 'answers are required' }, { status: 400 })
  await sql(
    `INSERT INTO submissions (exam_id, student_id, answers) VALUES ($1,$2,$3)
     ON CONFLICT (exam_id, student_id) DO UPDATE SET answers = EXCLUDED.answers, submitted_at = now()`,
    [id, caller.username, JSON.stringify(answers)],
  )
  await audit(caller.username, caller.role, 'submit_exam', `exam#${id}`, 'success')
  return NextResponse.json({ ok: true })
}
