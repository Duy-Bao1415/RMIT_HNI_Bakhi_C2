import { NextRequest, NextResponse } from 'next/server'
import { authorize, isResponse } from '@/lib/auth'
import { sql, audit } from '@/lib/db'
import { examWithProgress, drawQuestions, QUORUM } from '@/lib/exams'

// Records one committee member's vote. This table only DISPLAYS progress: the real gate is
// the _tide_decryptor grant, which TideCloak applies only after the admin quorum signs it.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const caller = await authorize(req, ['committee'], 'approve_exam')
  if (isResponse(caller)) return caller
  const id = Number((await ctx.params).id)
  const { action = 'open' } = await req.json().catch(() => ({}))
  if (!['open', 'close'].includes(action)) return NextResponse.json({ error: 'action must be open|close' }, { status: 400 })
  const exam: any = await examWithProgress(id)
  if (!exam) return NextResponse.json({ error: 'Exam not found' }, { status: 404 })
  if (action === 'close' && exam.status !== 'open') return NextResponse.json({ error: 'The exam is not open' }, { status: 409 })
  if (action === 'open' && !['locked', 'pending'].includes(exam.status)) return NextResponse.json({ error: `The exam is already ${exam.status}` }, { status: 409 })

  const inserted = await sql(
    'INSERT INTO approvals (exam_id, committee_id, action) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING 1',
    [id, caller.username, action],
  )
  if (!inserted.length) return NextResponse.json({ error: 'You have already approved' }, { status: 409 })
  await audit(caller.username, caller.role, `approve_${action}`, `exam#${id}`, 'success')

  const [{ count }] = await sql<{ count: number }>('SELECT count(*)::int AS count FROM approvals WHERE exam_id = $1 AND action = $2', [id, action])
  let status = exam.status
  let drawn = 0
  if (action === 'open') {
    if (count >= QUORUM) {
      const picked = await drawQuestions(id, exam.subject, exam.num_questions)
      drawn = picked.length
      status = 'open'
      await audit('system', 'system', 'draw_questions', `exam#${id} (${drawn} questions)`, 'success')
    } else {
      status = 'pending'
    }
  } else if (count >= QUORUM) {
    status = 'closed'
  }
  await sql('UPDATE exams SET status = $2 WHERE id = $1', [id, status])
  if (status !== exam.status) await audit('system', 'system', `status_${status}`, `exam#${id}`, 'success')
  return NextResponse.json({ status, count, quorum: QUORUM, drawn })
}
