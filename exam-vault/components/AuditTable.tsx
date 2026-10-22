'use client'
import { useEffect, useState } from 'react'
import { useTideCloak } from '@tidecloak/nextjs'
import { useApi, fmtTime } from '@/lib/client'
import { displayName } from '@/lib/names'

export default function AuditTable({ refreshKey = 0 }: { refreshKey?: number }) {
  const api = useApi()
  const { token } = useTideCloak()
  const [logs, setLogs] = useState<any[]>([])
  useEffect(() => {
    if (token) api('/api/audit').then((d) => setLogs(d.logs)).catch(() => {})
  }, [token, api, refreshKey])
  const denied = logs.filter((l) => l.result !== 'success').length
  return (
    <div className="card">
      <div className="card-head">
        <div className="section-title"><span className="icon">📜</span><h2>Audit log</h2></div>
        <span className="muted">{logs.length} events · {denied} denied</span>
      </div>
      <div className="table-scroll" style={{ maxHeight: 380, overflowY: 'auto' }}>
        <table>
          <thead><tr><th>Time</th><th>Actor</th><th>Role</th><th>Action</th><th>Target</th><th>Result</th></tr></thead>
          <tbody>
            {logs.length === 0 && <tr><td colSpan={6} className="muted">No events yet.</td></tr>}
            {logs.map((l) => (
              <tr key={l.id}><td style={{ whiteSpace: 'nowrap' }}>{fmtTime(l.at)}</td><td>{displayName(l.actor)}</td><td>{l.role}</td><td>{l.action}</td><td className="mono">{l.target}</td>
                <td><span className={`badge ${l.result}`}>{l.result === 'success' ? 'success' : 'denied'}</span></td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
