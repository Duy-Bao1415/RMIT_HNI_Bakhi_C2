'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTideCloak } from '@tidecloak/nextjs'
import { Logo } from '@/components/Shell'

const FEATURES = [
  { n: 1, t: 'Lecturers write, but can never read back', d: 'Each question is encrypted in the lecturer’s browser before it leaves. The server only ever receives ciphertext.' },
  { n: 2, t: 'Admins see only ciphertext', d: 'The database, the S3 bucket and the cloud provider hold encrypted blobs. There is no master key to steal.' },
  { n: 3, t: 'A quorum opens the exam', d: 'Students get decryption rights only after enough committee members sign in the Tide enclave.' },
  { n: 4, t: 'Random draw on encrypted data', d: 'The server picks questions by ID without being able to read them, and every student gets their own version.' },
]

export default function LandingPage() {
  const { login, authenticated } = useTideCloak()
  const router = useRouter()

  useEffect(() => {
    if (authenticated) router.push('/home')
  }, [authenticated, router])

  return (
    <>
      <div className="topbar"><div className="wrap"><Logo /></div></div>
      <div className="hero">
        <div className="wrap" style={{ paddingBottom: 0 }}>
          <div className="eyebrow" style={{ color: '#a5b4fc' }}>UNLOCKED Hackathon · Challenge 2</div>
          <h1>The exam only appears at exam time, when the committee agrees.</h1>
          <p>A shared exam bank where nobody knows the questions in advance: not the authors, not the IT admin, not the server and not the cloud provider.</p>
          <div className="cta">
            <button className="big" onClick={() => login()}>Sign in with Tide</button>
          </div>
          <div className="pill-row">
            <span className="pill">BYOiD login</span>
            <span className="pill">End-to-end encryption</span>
            <span className="pill">Quorum-enforced governance</span>
            <span className="pill">No god-mode admin</span>
          </div>
        </div>
      </div>
      <div className="wrap lift">
        <div className="grid">
          {FEATURES.map((f) => (
            <div className="card feature" key={f.n}>
              <span className="num">{f.n}</span>
              <h3>{f.t}</h3>
              <p className="muted" style={{ margin: 0 }}>{f.d}</p>
            </div>
          ))}
        </div>
        <div className="foot">“If you remove TideCloak, the admin can read and open the exam. With TideCloak, the key is nowhere - the right to read only appears when the quorum signs.”</div>
      </div>
    </>
  )
}
