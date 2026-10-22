// Server side of the app's own exam-bank key (used instead of committee-signed Tide policies).
// An RSA key pair kept in a file next to the app, NOT in the database, so the IT admin's
// database access does not include it. Lecturers get the public half; a student gets the
// private half only while one of their exams is open (see app/api/bank-key/route.ts).
import { generateKeyPairSync, type JsonWebKey } from 'crypto'
import { readFileSync, writeFileSync } from 'fs'
import path from 'path'

interface BankKeyPair { publicJwk: JsonWebKey; privateJwk: JsonWebKey }

const FILE = process.env.BANK_KEY_FILE || path.join(process.cwd(), '.bank-key.json')
const g = globalThis as unknown as { __zlBankKey?: BankKeyPair }

export function bankKeyPair(): BankKeyPair {
  if (g.__zlBankKey) return g.__zlBankKey
  try {
    g.__zlBankKey = JSON.parse(readFileSync(FILE, 'utf8')) as BankKeyPair
  } catch (e: any) {
    if (e?.code !== 'ENOENT') throw e
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const pair = { publicJwk: publicKey.export({ format: 'jwk' }), privateJwk: privateKey.export({ format: 'jwk' }) }
    try {
      // 'wx': never overwrite a key another request just wrote - data sealed with it would be lost.
      writeFileSync(FILE, JSON.stringify(pair), { flag: 'wx', mode: 0o600 })
      g.__zlBankKey = pair
    } catch (w: any) {
      if (w?.code !== 'EEXIST') throw w
      g.__zlBankKey = JSON.parse(readFileSync(FILE, 'utf8')) as BankKeyPair
    }
  }
  return g.__zlBankKey!
}
