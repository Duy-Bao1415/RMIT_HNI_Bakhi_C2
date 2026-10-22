import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { authorize, isResponse } from '@/lib/auth'
import { sql, audit } from '@/lib/db'
import { putCiphertext, s3Configured } from '@/lib/s3'

const MAX_CIPHERTEXT = 8 * 1024 * 1024

// Contributor attaches an image/PDF to their own question. The browser has already
// encrypted it; we store the ciphertext as exam-files/<uuid>.bin.
export async function POST(req: NextRequest) {
  const caller = await authorize(req, ['contributor'], 'upload_file')
  if (isResponse(caller)) return caller
  if (!s3Configured()) return NextResponse.json({ error: 'S3 is not configured (S3_BUCKET / AWS_* in .env.local)' }, { status: 503 })
  const { question_id, file_name, mime, ciphertext } = await req.json()
  if (typeof ciphertext !== 'string' || ciphertext.length < 16 || ciphertext.length > MAX_CIPHERTEXT) {
    return NextResponse.json({ error: 'ciphertext missing or too large' }, { status: 400 })
  }
  const [q] = await sql('SELECT id FROM questions WHERE id = $1 AND author_id = $2', [question_id, caller.sub])
  if (!q) return NextResponse.json({ error: 'Not your question' }, { status: 403 })
  const key = `exam-files/${randomUUID()}.bin`
  await putCiphertext(key, ciphertext)
  const [row] = await sql<{ id: number }>(
    'INSERT INTO files (question_id, s3_key, file_name, mime, size) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [question_id, key, String(file_name ?? '').slice(0, 200), String(mime ?? 'application/octet-stream').slice(0, 100), ciphertext.length],
  )
  await audit(caller.username, caller.role, 'upload_file', `${key} (question#${question_id})`, 'success')
  return NextResponse.json({ id: row.id, key })
}
