import { NextRequest, NextResponse } from 'next/server'
import { authorize, isResponse } from '@/lib/auth'
import { sql, audit } from '@/lib/db'
import { listObjects, s3Configured } from '@/lib/s3'

// What an IT admin (or anyone who dumps the database / bucket) actually gets: ciphertext.
export async function GET(req: NextRequest) {
  const caller = await authorize(req, ['admin'], 'view_raw')
  if (isResponse(caller)) return caller
  const questions = await sql('SELECT id, author_name, subject, ciphertext, created_at FROM questions ORDER BY id DESC LIMIT 100')
  const exams = await sql('SELECT id, title, subject, status, question_ids, start_time FROM exams ORDER BY id DESC')
  const files = await sql('SELECT id, question_id, s3_key, file_name, mime, size, created_at FROM files ORDER BY id DESC LIMIT 100')
  let bucket: { key: string; size: number; modified?: Date }[] = []
  let bucketError = ''
  if (s3Configured()) {
    try { bucket = await listObjects() } catch (e: any) { bucketError = e?.message ?? String(e) }
  } else bucketError = 'S3 is not configured'
  await audit(caller.username, caller.role, 'view_raw_db', 'questions+files', 'success')
  return NextResponse.json({ questions, exams, files, bucket, bucketError })
}
