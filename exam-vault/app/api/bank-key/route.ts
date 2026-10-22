import { NextRequest, NextResponse } from 'next/server'
import { authorize, isResponse } from '@/lib/auth'
import { sql, audit } from '@/lib/db'
import { effectiveStatus } from '@/lib/exams'
import { bankKeyPair } from '@/lib/bankKey'

// The app's own exam-bank key. Lecturers (and the committee) get the PUBLIC key: they can
// seal questions but never read them back. A student gets the PRIVATE key only for an exam
// they sit that is open (committee quorum reached). Everyone else - the IT admin included - is denied.
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('use') !== 'decrypt') {
    const caller = await authorize(req, ['contributor', 'committee'], 'bank_key')
    if (isResponse(caller)) return caller
    return NextResponse.json({ publicJwk: bankKeyPair().publicJwk })
  }

  const caller = await authorize(req, ['student'], 'bank_key_decrypt')
  if (isResponse(caller)) return caller
  const id = Number(req.nextUrl.searchParams.get('exam'))
  const [exam] = await sql(
    `SELECT e.* FROM exams e JOIN exam_students s ON s.exam_id = e.id
     WHERE e.id = $1 AND s.student_id = $2`,
    [id, caller.username],
  )
  if (!exam || effectiveStatus(exam) !== 'open') {
    await audit(caller.username, caller.role, 'bank_key_decrypt', `exam#${id}`, 'denied')
    return NextResponse.json({ error: exam ? 'The exam is not open yet' : 'You are not registered for this exam' }, { status: 403 })
  }
  await audit(caller.username, caller.role, 'bank_key_decrypt', `exam#${id}`, 'success')
  return NextResponse.json({ privateJwk: bankKeyPair().privateJwk })
}
