import { NextRequest, NextResponse } from 'next/server'
import { authorize, isResponse } from '@/lib/auth'
import { sql, audit } from '@/lib/db'

// Network-signed RelationshipAttestation policies. They are not secrets (a policy only works
// for a caller who matches its subject AND holds the realm role), but only the committee's
// realm admin may store one, so nobody can swap in junk and lock users out.
const NAMES = ['contributor-write', 'student-read']

export async function GET(req: NextRequest) {
  const caller = await authorize(req, ['contributor', 'committee', 'student', 'admin'])
  if (isResponse(caller)) return caller
  const name = req.nextUrl.searchParams.get('name')
  if (name) {
    const [row] = await sql('SELECT name, policy_b64, granted_by, created_at FROM policies WHERE name = $1', [name])
    if (!row) return NextResponse.json({ error: `Policy "${name}" has not been signed by the committee yet` }, { status: 404 })
    return NextResponse.json(row)
  }
  const rows = await sql('SELECT name, granted_by, created_at FROM policies ORDER BY name')
  return NextResponse.json({ policies: rows })
}

export async function POST(req: NextRequest) {
  const caller = await authorize(req, ['committee'], 'store_policy')
  if (isResponse(caller)) return caller
  const { name, policy } = await req.json()
  if (!NAMES.includes(name) || typeof policy !== 'string' || policy.length < 32) {
    return NextResponse.json({ error: 'invalid policy' }, { status: 400 })
  }
  await sql(
    `INSERT INTO policies (name, policy_b64, granted_by) VALUES ($1,$2,$3)
     ON CONFLICT (name) DO UPDATE SET policy_b64 = EXCLUDED.policy_b64, granted_by = EXCLUDED.granted_by, created_at = now()`,
    [name, policy, caller.username],
  )
  await audit(caller.username, caller.role, 'sign_policy', name, 'success')
  return NextResponse.json({ ok: true })
}
