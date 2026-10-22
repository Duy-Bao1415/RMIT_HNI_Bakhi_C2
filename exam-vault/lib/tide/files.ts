'use client'
// Encrypt / decrypt attachments in the browser. The file is base64-encoded and goes through
// the same text path as questions (the bank key), so the only thing that ever leaves the
// browser - to our server and on to S3 - is ciphertext.
import type { Open, Seal } from '../vault'

export const MAX_FILE_BYTES = 2 * 1024 * 1024

function bytesToB64(b: Uint8Array) {
  let s = ''
  const CHUNK = 0x8000
  for (let i = 0; i < b.length; i += CHUNK) s += String.fromCharCode(...b.subarray(i, i + CHUNK))
  return btoa(s)
}

export async function encryptFile(file: File, seal: Seal): Promise<string> {
  if (file.size > MAX_FILE_BYTES) throw new Error(`File too large (max ${MAX_FILE_BYTES / 1024 / 1024} MB)`)
  const b64 = bytesToB64(new Uint8Array(await file.arrayBuffer()))
  return seal(b64)
}

export async function decryptFile(ciphertext: string, open: Open, mime: string): Promise<Blob> {
  const b64 = await open(ciphertext)
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  return new Blob([bytes], { type: mime || 'application/octet-stream' })
}
