import { NextRequest, NextResponse } from 'next/server'
import { authorize, isResponse } from '@/lib/auth'
import { sql, audit } from '@/lib/db'

// Contributor submits an already-encrypted question. The server never sees plaintext.
export async function POST(req: NextRequest) {
  const caller = await authorize(req, ['contributor'], 'submit_question')
  if (isResponse(caller)) return caller
  const { ciphertext, subject } = await req.json()
  if (typeof ciphertext !== 'string' || ciphertext.length < 16 || typeof subject !== 'string' || !subject.trim()) {
    return NextResponse.json({ error: 'ciphertext and subject are required' }, { status: 400 })
  }
  if (/"stem"\s*:/.test(ciphertext)) {
    // Defence in depth: refuse anything that looks like a plaintext question JSON.
    return NextResponse.json({ error: 'Rejected: the data is not encrypted' }, { status: 400 })
  }
  const [row] = await sql<{ id: number }>(
    'INSERT INTO questions (author_id, author_name, subject, ciphertext) VALUES ($1,$2,$3,$4) RETURNING id',
    [caller.sub, caller.username, subject.trim(), ciphertext],
  )
  await audit(caller.username, caller.role, 'submit_question', `question#${row.id}`, 'success')
  return NextResponse.json({ id: row.id })
}
