// Smoke test for the parts that need no Tide login: every API route must refuse a caller
// without a valid token, and every role page must be gated server-side by proxy.ts.
// Usage: npm run dev (in another terminal), then: node scripts/smoke-test.mjs [baseUrl]
const BASE = process.argv[2] || 'http://localhost:3000'
const FAKE = 'Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJoYWNrZXIifQ.c2ln'

const results = []
async function check(name, fn) {
  try {
    await fn()
    results.push([true, name])
  } catch (e) {
    results.push([false, `${name} -> ${e.message}`])
  }
}
function expect(cond, msg) {
  if (!cond) throw new Error(msg)
}

const API = [
  ['GET', '/api/exams'],
  ['POST', '/api/exams'],
  ['GET', '/api/exams/1'],
  ['POST', '/api/exams/1/approve'],
  ['POST', '/api/exams/1/force-open'],
  ['POST', '/api/exams/1/submit'],
  ['POST', '/api/questions'],
  ['GET', '/api/questions/mine'],
  ['GET', '/api/admin/raw'],
  ['GET', '/api/policies'],
  ['POST', '/api/policies'],
  ['GET', '/api/audit'],
  ['POST', '/api/files'],
  ['GET', '/api/files/1'],
]
const PAGES = ['/contributor', '/committee', '/exam', '/admin']

await check('Landing page loads (200)', async () => {
  const r = await fetch(BASE + '/')
  expect(r.status === 200, `got ${r.status}`)
})

for (const [method, path] of API) {
  const body = method === 'POST' ? '{}' : undefined
  await check(`${method} ${path} without token -> 401`, async () => {
    const r = await fetch(BASE + path, { method, body, headers: body ? { 'Content-Type': 'application/json' } : {} })
    expect(r.status === 401, `got ${r.status}`)
  })
  await check(`${method} ${path} with forged token -> 401/403`, async () => {
    const r = await fetch(BASE + path, { method, body, headers: { Authorization: FAKE, ...(body ? { 'Content-Type': 'application/json' } : {}) } })
    expect([401, 403].includes(r.status), `got ${r.status}`)
  })
}

for (const p of PAGES) {
  await check(`Page ${p} without session is redirected away`, async () => {
    const r = await fetch(BASE + p, { redirect: 'manual' })
    const loc = r.headers.get('location') || ''
    expect(r.status >= 300 && r.status < 400, `got ${r.status}`)
    expect(!loc.includes(p), `redirected to ${loc}`)
  })
}

for (const [ok, name] of results) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
const failed = results.filter(([ok]) => !ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
