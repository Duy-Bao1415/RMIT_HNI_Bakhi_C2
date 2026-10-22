import { NextRequest, NextResponse } from 'next/server'
import { authorize, isResponse } from '@/lib/auth'
import { sql, audit } from '@/lib/db'
import { examWithProgress, effectiveStatus } from '@/lib/exams'

export async function GET(req: NextRequest) {
  const caller = await authorize(req, ['contributor', 'committee', 'student', 'admin'])
  if (isResponse(caller)) return caller
  const rows = caller.role === 'student'
    ? await sql('SELECT e.id FROM exams e JOIN exam_students s ON s.exam_id = e.id WHERE s.student_id = $1 ORDER BY e.start_time DESC', [caller.username])
    : await sql('SELECT id FROM exams ORDER BY start_time DESC')
  const exams = []
  for (const r of rows) {
    const e: any = await examWithProgress(r.id)
    if (!e) continue
    e.status = effectiveStatus(e)
    // Which questions were drawn is itself sensitive: never list the ids.
    e.question_count = e.question_ids.length
    delete e.question_ids
    exams.push(e)
  }
  return NextResponse.json({ exams })
}

export async function POST(req: NextRequest) {
  const caller = await authorize(req, ['committee'], 'create_exam')
  if (isResponse(caller)) return caller
  const b = await req.json()
  const students: string[] = String(b.students ?? '').split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean)
  if (!b.title || !b.subject || !b.start_time || students.length === 0) {
    return NextResponse.json({ error: 'Title, subject, start time and at least one student are required' }, { status: 400 })
  }
  const [exam] = await sql<{ id: number }>(
    `INSERT INTO exams (title, subject, start_time, duration_min, num_questions, num_versions, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [b.title, b.subject, new Date(b.start_time), Number(b.duration_min) || 60, Number(b.num_questions) || 10, Number(b.num_versions) || 1, caller.username],
  )
  for (const s of students) {
    await sql('INSERT INTO exam_students (exam_id, student_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [exam.id, s])
  }
  await audit(caller.username, caller.role, 'create_exam', `exam#${exam.id}`, 'success')
  return NextResponse.json({ id: exam.id })
}
