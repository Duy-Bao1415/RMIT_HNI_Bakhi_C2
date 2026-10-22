// Server-side authorization for API routes. Every route verifies the JWT signature
// (embedded realm JWK) and the caller's realm role here - a UI check is never authorization.
import { NextRequest, NextResponse } from 'next/server'
import { verifyTideCloakToken } from '@tidecloak/nextjs/server'
import tcConfig from '../tidecloak.json'
import { audit } from './db'

export type AppRole = 'contributor' | 'committee' | 'student' | 'admin'

export interface Caller {
  sub: string
  username: string
  name: string
  roles: string[]
  role: string
  isRealmAdmin: boolean
  token: string
}

const ROLE_ORDER: AppRole[] = ['admin', 'committee', 'contributor', 'student']

export async function authorize(
  req: NextRequest,
  allowed: AppRole[],
  action = 'api',
): Promise<Caller | NextResponse> {
  const header = req.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized: missing token' }, { status: 401 })
  }
  const token = header.slice(7)
  // Signature + issuer check only; we evaluate roles ourselves so a wrong-role caller
  // can be logged as "denied" rather than silently rejected.
  const payload = (await verifyTideCloakToken(tcConfig, token, [])) as Record<string, any> | null
  if (!payload) {
    return NextResponse.json({ error: 'Forbidden: invalid token' }, { status: 403 })
  }
  const roles: string[] = payload.realm_access?.roles ?? []
  const mgmt: string[] = payload.resource_access?.['realm-management']?.roles ?? []
  const caller: Caller = {
    sub: payload.sub,
    username: payload.preferred_username ?? payload.sub,
    name: [payload.given_name, payload.family_name].filter(Boolean).join(' ') || payload.preferred_username,
    roles,
    role: ROLE_ORDER.find((r) => roles.includes(r)) ?? 'none',
    isRealmAdmin: mgmt.includes('tide-realm-admin'),
    token,
  }
  if (!allowed.some((r) => roles.includes(r))) {
    await audit(caller.username, caller.role, action, req.nextUrl.pathname, 'denied')
    return NextResponse.json(
      { error: `Forbidden: role ${allowed.join('/')} required` },
      { status: 403 },
    )
  }
  return caller
}

export const isResponse = (x: unknown): x is NextResponse => x instanceof NextResponse
