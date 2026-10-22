import { NextRequest, NextResponse } from 'next/server'
import { authorize, isResponse } from '@/lib/auth'
import { audit } from '@/lib/db'

// The "god-mode" button for the demo. There is no code path that opens an exam without the
// committee quorum, and even editing the DB to status=open grants no decryption: students
// still lack the quorum-signed _tide_decryptor role.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const caller = await authorize(req, ['admin', 'committee', 'contributor', 'student'], 'force_open')
  if (isResponse(caller)) return caller
  const id = (await ctx.params).id
  await audit(caller.username, caller.role, 'force_open', `exam#${id}`, 'denied')
  return NextResponse.json(
    { error: 'Denied: nobody can open an exam alone. It needs the committee quorum and Tide signatures.' },
    { status: 403 },
  )
}
