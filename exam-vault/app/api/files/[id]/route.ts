import { NextRequest, NextResponse } from 'next/server'
import { authorize, isResponse } from '@/lib/auth'
import { sql, audit } from '@/lib/db'
import { getCiphertext } from '@/lib/s3'
import { effectiveStatus } from '@/lib/exams'

// Returns an attachment's CIPHERTEXT. A student gets it only for a question drawn into an
// open exam they sit; the admin gets it to show what the bucket really holds. Either way
// it decrypts only in a browser the Tide network agrees to.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const caller = await authorize(req, ['student', 'admin'], 'fetch_file')
  if (isResponse(caller)) return caller
  const id = Number((await ctx.params).id)
  const [file] = await sql('SELECT * FROM files WHERE id = $1', [id])
  if (!file) return NextResponse.json({ error: 'File not found' }, { status: 404 })

  if (caller.role === 'student') {
    const exams = await sql(
      `SELECT e.* FROM exams e JOIN exam_students s ON s.exam_id = e.id
       WHERE s.student_id = $1 AND $2 = ANY(e.question_ids)`,
      [caller.username, file.question_id],
    )
    if (!exams.some((e: any) => effectiveStatus(e) === 'open')) {
      await audit(caller.username, caller.role, 'fetch_file', `file#${id}`, 'denied')
      return NextResponse.json({ error: 'This file is not part of an open exam you are sitting' }, { status: 403 })
    }
  }
  const ciphertext = await getCiphertext(file.s3_key)
  await audit(caller.username, caller.role, 'fetch_file', `${file.s3_key}`, 'success')
  return NextResponse.json({ id, file_name: file.file_name, mime: file.mime, s3_key: file.s3_key, ciphertext })
}
