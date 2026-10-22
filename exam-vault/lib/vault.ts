'use client'
// Seal / open exam-bank items in the browser with the app's own bank key (no Tide policy to sign).
// Hybrid encryption: a fresh AES-GCM key per item, wrapped with the bank's RSA-OAEP public key.
// Ciphertext is "zlv1:" + base64(JSON). Items sealed earlier under a Tide policy still open
// through the Tide network.
import { decryptForRecord } from './tide/relationship'
import { BANK_RECORD_ID } from './tide/govern'

type Api = <T = any>(path: string, init?: RequestInit) => Promise<T>
export type Seal = (plaintext: string) => Promise<string>
export type Open = (ciphertext: string) => Promise<string>

const PREFIX = 'zlv1:'
const RSA = { name: 'RSA-OAEP', hash: 'SHA-256' }

function toB64(b: Uint8Array) {
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(s)
}
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

/** For lecturers: fetches the bank's public key once; the returned function can only encrypt. */
export async function bankSealer(api: Api): Promise<Seal> {
  const { publicJwk } = await api<{ publicJwk: JsonWebKey }>('/api/bank-key')
  const pub = await crypto.subtle.importKey('jwk', publicJwk, RSA, false, ['encrypt'])
  return async (plaintext) => {
    const aes = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt'])
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, new TextEncoder().encode(plaintext))
    const k = await crypto.subtle.encrypt(RSA, pub, await crypto.subtle.exportKey('raw', aes))
    return PREFIX + btoa(JSON.stringify({ k: toB64(new Uint8Array(k)), iv: toB64(iv), ct: toB64(new Uint8Array(ct)) }))
  }
}

/** For students: the private key is fetched on first use and only for an open exam they sit. */
export function bankOpener(api: Api, examId?: number): Open {
  let priv: Promise<CryptoKey> | undefined
  let tidePolicy: Promise<string> | undefined
  return async (ciphertext) => {
    if (!ciphertext.startsWith(PREFIX)) {
      tidePolicy ??= api<{ policy_b64: string }>('/api/policies?name=student-read').then((r) => r.policy_b64)
      return decryptForRecord(ciphertext, BANK_RECORD_ID, await tidePolicy)
    }
    priv ??= api<{ privateJwk: JsonWebKey }>(`/api/bank-key?use=decrypt&exam=${examId ?? ''}`)
      .then((r) => crypto.subtle.importKey('jwk', r.privateJwk, RSA, false, ['decrypt']))
    const { k, iv, ct } = JSON.parse(atob(ciphertext.slice(PREFIX.length)))
    const raw = await crypto.subtle.decrypt(RSA, await priv, fromB64(k))
    const aes = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt'])
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, aes, fromB64(ct)))
  }
}
