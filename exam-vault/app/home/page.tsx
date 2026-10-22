'use client'
// After login: send each user to the page for their role.
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTideCloak } from '@tidecloak/nextjs'
import { useAppRole, homeFor } from '@/components/Shell'
import { displayName } from '@/lib/names'

export default function HomePage() {
  const { authenticated, isInitializing, logout, getValueFromIdToken } = useTideCloak()
  const role = useAppRole()
  const router = useRouter()

  useEffect(() => {
    if (isInitializing) return
    if (!authenticated) router.replace('/')
    else if (role) router.replace(homeFor(role))
  }, [authenticated, isInitializing, role, router])

  if (authenticated && !isInitializing && !role) {
    return (
      <div className="center">
        <div className="lock-icon">👤</div>
        <h1>Hello, {displayName(getValueFromIdToken('preferred_username'))}</h1>
        <p className="muted">Your account has no role yet (lecturer / committee / student / IT admin).</p>
        <button onClick={() => logout()}>Sign out</button>
      </div>
    )
  }
  return <div className="center muted">Redirecting…</div>
}
