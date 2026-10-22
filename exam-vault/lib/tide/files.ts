'use client'
// Encrypt / decrypt attachments in the browser. The file is base64-encoded and goes through
// the same text path as questions (one tag: the bank record id), so the only thing that
// ever leaves the browser - to our server and on to S3 - is ciphertext.
import { encryptForRecord, decryptForRecord } from './relationship'
import { BANK_RECORD_ID } from './govern'

export const MAX_FILE_BYTES = 2 * 1024 * 1024

function bytesToB64(b: Uint8Array) {
  let s = ''
  const CHUNK = 0x8000
  for (let i = 0; i < b.length; i += CHUNK) s += String.fromCharCode(...b.subarray(i, i + CHUNK))
  return btoa(s)
}

export async function encryptFile(file: File, policyB64: string): Promise<string> {
  if (file.size > MAX_FILE_BYTES) throw new Error(`File too large (max ${MAX_FILE_BYTES / 1024 / 1024} MB)`)
  const b64 = bytesToB64(new Uint8Array(await file.arrayBuffer()))
  return encryptForRecord(b64, BANK_RECORD_ID, policyB64)
}

export async function decryptFile(ciphertext: string, policyB64: string, mime: string): Promise<Blob> {
  const b64 = await decryptForRecord(ciphertext, BANK_RECORD_ID, policyB64)
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  return new Blob([bytes], { type: mime || 'application/octet-stream' })
}
