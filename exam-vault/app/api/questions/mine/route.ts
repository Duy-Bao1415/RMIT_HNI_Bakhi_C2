import { NextRequest, NextResponse } from 'next/server'
import { authorize, isResponse } from '@/lib/auth'
import { sql } from '@/lib/db'

// Metadata only: a contributor can never get their question content back.
export async function GET(req: NextRequest) {
  const caller = await authorize(req, ['contributor'])
  if (isResponse(caller)) return caller
  const mine = await sql(
    'SELECT id, subject, created_at, length(ciphertext) AS size FROM questions WHERE author_id = $1 ORDER BY id DESC',
    [caller.sub],
  )
  const bank = await sql('SELECT subject, count(*)::int AS count FROM questions GROUP BY subject ORDER BY subject')
  return NextResponse.json({ mine, bank })
}
