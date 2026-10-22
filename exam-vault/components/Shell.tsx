'use client'
// Page frame: header with identity + logout, and a client-side role gate for the UI.
// The UI gate is cosmetic; proxy.ts and every API route enforce roles on the server.
import { useTideCloak } from '@tidecloak/nextjs'
import type { ReactNode } from 'react'
import { displayName } from '@/lib/names'

export const ROLE_LABEL: Record<string, string> = {
  contributor: 'Lecturer',
  committee: 'Exam Committee',
  student: 'Student',
  admin: 'IT Admin',
}
const ROLE_HOME: Record<string, string> = {
  contributor: '/contributor',
  committee: '/committee',
  student: '/exam',
  admin: '/admin',
}
export const APP_ROLES = ['admin', 'committee', 'contributor', 'student']

export function useAppRole() {
  const { hasRealmRole, authenticated } = useTideCloak()
  if (!authenticated) return null
  return APP_ROLES.find((r) => hasRealmRole(r)) ?? null
}
export const homeFor = (role: string | null) => (role ? ROLE_HOME[role] : '/')

export function Logo() {
  return (
    <a className="brand" href="/">
      <span className="brand-mark" aria-hidden>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3l7 3v6c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V6l7-3z" /><path d="M9.5 12.5l2 2 3.5-4" />
        </svg>
      </span>
      <span>Zero-Leak Exam Vault<small>Secured by TideCloak</small></span>
    </a>
  )
}

export default function Shell({ role, eyebrow, title, subtitle, actions, children }: {
  role: string; eyebrow?: string; title: string; subtitle?: string; actions?: ReactNode; children: ReactNode
}) {
  const { authenticated, isInitializing, login, logout, getValueFromIdToken, hasRealmRole } = useTideCloak()

  if (isInitializing) return <div className="center muted">Starting your Tide session…</div>
  if (!authenticated) {
    return (
      <div className="center">
        <div className="lock-icon">🔐</div>
        <h1>Zero-Leak Exam Vault</h1>
        <p className="muted">Please sign in to continue.</p>
        <button className="big" onClick={() => login()}>Sign in with Tide</button>
      </div>
    )
  }
  const name = displayName(getValueFromIdToken('preferred_username'))
  const roles = APP_ROLES.filter((r) => hasRealmRole(r)).map((r) => ROLE_LABEL[r])
  const allowed = hasRealmRole(role)
  return (
    <>
      <div className="topbar">
        <div className="wrap">
          <Logo />
          <div className="who">
            {roles.map((r) => <span key={r} className="role-chip">{r}</span>)}
            <span className="avatar" aria-hidden>{name.slice(0, 2)}</span>
            <span>{name}</span>
            <button onClick={() => logout()}>Sign out</button>
          </div>
        </div>
      </div>
      <div className="wrap">
        <div className="page-head">
          <div>
            {eyebrow && <div className="eyebrow">{eyebrow}</div>}
            <h1>{title}</h1>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions}
        </div>
        {allowed ? children : (
          <div className="note bad">This page is for the “{ROLE_LABEL[role]}” role. Your account does not have it.</div>
        )}
        <div className="foot">Questions are encrypted in the browser · keys are split across the Tide Cybersecurity Fabric · nobody holds a master key</div>
      </div>
    </>
  )
}
