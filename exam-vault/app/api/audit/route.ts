import { NextRequest, NextResponse } from 'next/server'
import { authorize, isResponse } from '@/lib/auth'
import { sql, audit } from '@/lib/db'

export async function GET(req: NextRequest) {
  const caller = await authorize(req, ['committee', 'admin'])
  if (isResponse(caller)) return caller
  const rows = await sql('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 200')
  return NextResponse.json({ logs: rows })
}

// Browser-side events the server cannot observe itself (e.g. a decryption the Tide network refused).
const CLIENT_ACTIONS = ['decrypt_attempt', 'self_grant_attempt', 'tide_grant_request', 'tide_approve', 'encrypt_attempt']
export async function POST(req: NextRequest) {
  const caller = await authorize(req, ['contributor', 'committee', 'student', 'admin'])
  if (isResponse(caller)) return caller
  const { action, target, result } = await req.json()
  if (!CLIENT_ACTIONS.includes(action)) return NextResponse.json({ error: 'invalid action' }, { status: 400 })
  await audit(caller.username, caller.role, action, String(target ?? '').slice(0, 200), result === 'success' ? 'success' : 'denied')
  return NextResponse.json({ ok: true })
}
