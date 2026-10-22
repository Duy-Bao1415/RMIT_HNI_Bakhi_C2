'use client'
// Small browser helpers shared by the role pages.
import { useCallback } from 'react'
import { useTideCloak } from '@tidecloak/nextjs'

export function useApi() {
  const { token } = useTideCloak()
  return useCallback(
    async <T = any>(path: string, init: RequestInit = {}): Promise<T> => {
      const res = await fetch(path, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...(init.headers ?? {}),
        },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      return data as T
    },
    [token],
  )
}

/** Tide errors hide the contract's real message in `cause`; surface it for the UI. */
export function tideErrorText(e: unknown): string {
  const parts: string[] = []
  let cur: any = e
  for (let i = 0; cur && i < 4; i++) {
    if (cur.message) parts.push(String(cur.message))
    cur = cur.cause
  }
  return parts.join(' ← ') || String(e)
}

export const fmtTime = (s: string | Date) =>
  new Date(s).toLocaleString('en-GB', { hour12: false })
