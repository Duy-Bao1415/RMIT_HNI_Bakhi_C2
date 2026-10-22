// Browser-side helpers for Tide governance (IGA change requests) and the exam-bank policies.
//
// Approvals are sent from the approver's OWN browser with their OWN token, never proxied
// through our server: TideCloak credits an approval to whoever authenticated the request,
// and in MultiAdmin mode each approval must be signed in the Tide enclave.
import { IAMService } from '@tidecloak/js'
import tcConfig from '../../tidecloak.json'

const cfg = tcConfig as Record<string, any>
const BASE = String(cfg['auth-server-url'] ?? '').replace(/\/+$/, '')
export const REALM: string = cfg.realm
export const VENDOR_ID: string = cfg.vendorId

/** The single record id every exam question is tagged with (RelationshipAttestation assignmentId). */
export const BANK_RECORD_ID = 'zl-exam-bank'
export const DECRYPT_ROLE = '_tide_decryptor'

const b64ToBytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
const bytesToB64 = (b: Uint8Array) => {
  let s = ''
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i])
  return btoa(s)
}

interface TideClient {
  requestTideOperatorApproval(
    requests: { id: string; request: Uint8Array }[],
  ): Promise<{ id: string; request: Uint8Array; status: 'approved' | 'denied' | 'pending' }[]>
}
function tc(): TideClient {
  const client = (IAMService as unknown as { _tc: TideClient | null })._tc
  if (!client) throw new Error('TideCloak is not initialised - please sign in again')
  return client
}

async function tcAdmin(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}/admin/realms/${REALM}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  })
  const text = await res.text()
  let body: any = text
  try { body = text ? JSON.parse(text) : null } catch { /* keep text */ }
  return { status: res.status, ok: res.ok, body }
}

export interface ChangeRequest {
  id: string
  entityType: string
  entityId: string
  actionType: string
  status: string
  authorizationCount?: number
  authorizers?: { username: string; timestamp: number }[]
  threshold?: number
  readyToCommit?: boolean
  rows?: any[]
  requestedBy?: string
}

export async function findUserId(token: string, username: string): Promise<string> {
  const r = await tcAdmin(token, `/users?username=${encodeURIComponent(username)}&exact=true`)
  if (!r.ok || !Array.isArray(r.body) || !r.body[0]) throw new Error(`User ${username} not found (HTTP ${r.status})`)
  return r.body[0].id
}

async function decryptorRole(token: string) {
  const r = await tcAdmin(token, `/roles/${DECRYPT_ROLE}`)
  if (!r.ok) throw new Error(`Cannot read role ${DECRYPT_ROLE} (HTTP ${r.status})`)
  return { id: r.body.id, name: r.body.name }
}

/**
 * Ask TideCloak to grant (or revoke) _tide_decryptor for the given users. On an IGA realm
 * this does NOT change anything yet: it files one change request per user (HTTP 202),
 * which only takes effect once the admin quorum signs it in the Tide enclave.
 */
export async function requestDecryptorChange(token: string, usernames: string[], grant: boolean) {
  const role = await decryptorRole(token)
  const results: { username: string; status: number; note: string }[] = []
  for (const u of usernames) {
    const id = await findUserId(token, u)
    const r = await tcAdmin(token, `/users/${id}/role-mappings/realm`, {
      method: grant ? 'POST' : 'DELETE',
      body: JSON.stringify([role]),
    })
    results.push({
      username: u,
      status: r.status,
      note: r.status === 202 ? 'change request awaiting quorum' : r.ok ? 'applied immediately (!)' : JSON.stringify(r.body),
    })
  }
  return results
}

/** Usernames (of those given) that currently hold _tide_decryptor. */
export async function holdersOfDecryptor(token: string, usernames: string[]) {
  const holders: string[] = []
  for (const u of usernames) {
    const id = await findUserId(token, u)
    const r = await tcAdmin(token, `/users/${id}/role-mappings/realm`)
    if (r.ok && Array.isArray(r.body) && r.body.some((x: any) => x.name === DECRYPT_ROLE)) holders.push(u)
  }
  return holders
}

export async function listPending(token: string): Promise<ChangeRequest[]> {
  const r = await tcAdmin(token, `/iga/change-requests?status=PENDING`, { headers: { 'Cache-Control': 'no-store' } })
  if (!r.ok) throw new Error(`Cannot read change requests (HTTP ${r.status})`)
  return Array.isArray(r.body) ? r.body : []
}

/** Change requests that touch _tide_decryptor for any of these TideCloak user ids. */
export function decryptorRequestsFor(crs: ChangeRequest[], userIds: string[]) {
  return crs.filter(
    (cr) => userIds.includes(cr.entityId) && JSON.stringify(cr.rows ?? '').includes(DECRYPT_ROLE),
  )
}

/**
 * Approve change requests as the logged-in admin. Phase 1 asks the server which ceremony is
 * needed; MultiAdmin requests come back with a requestModel that the admin signs in ONE
 * enclave popup; phase 2 posts the signatures back. TideCloak commits on its own once the
 * threshold encoded in the signed tide-realm-admin policy is met.
 */
export async function approveRequests(token: string, ids: string[]) {
  const out: Record<string, any> = {}
  const needSign: { id: string; request: Uint8Array }[] = []
  for (const id of ids) {
    const r = await tcAdmin(token, `/iga/change-requests/${id}/approve`, { method: 'POST', body: '{}' })
    if (!r.ok) { out[id] = { error: `HTTP ${r.status}`, body: r.body }; continue }
    if (r.body?.mode === 'needs-approval' && r.body.requestModel) {
      needSign.push({ id, request: b64ToBytes(r.body.requestModel) })
    } else {
      out[id] = r.body
    }
  }
  if (needSign.length) {
    const signed = await tc().requestTideOperatorApproval(needSign)
    for (const s of signed) {
      if (s.status !== 'approved') { out[s.id] = { error: `enclave: ${s.status}` }; continue }
      const r = await tcAdmin(token, `/iga/change-requests/${s.id}/approve`, {
        method: 'POST',
        body: JSON.stringify({ requestModel: bytesToB64(s.request) }),
      })
      out[s.id] = r.ok ? r.body : { error: `HTTP ${r.status}`, body: r.body }
    }
  }
  return out
}

/** The realm's signed admin policy, needed to authorise signing a RelationshipAttestation policy. */
export async function fetchAdminPolicy(token: string): Promise<Uint8Array> {
  const r = await tcAdmin(token, `/iga/role-policies/name/tide-realm-admin`)
  if (!r.ok || !r.body?.policy) throw new Error(`Cannot fetch the admin policy (HTTP ${r.status})`)
  return b64ToBytes(r.body.policy)
}
