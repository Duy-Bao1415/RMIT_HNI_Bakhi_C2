// Postgres access (Neon in production, local Postgres in dev).
// The server only ever stores ciphertext, ids and metadata - never question plaintext.
import { Pool } from 'pg'

const globalForPool = globalThis as unknown as { __zlPool?: Pool; __zlMigrated?: Promise<void> }

function pool(): Pool {
  if (!globalForPool.__zlPool) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is not set (see .env.example)')
    // Neon URLs carry sslmode=require, which node-postgres treats as verify-full (certificate
    // checked). Local Postgres URLs carry no sslmode and connect without TLS.
    globalForPool.__zlPool = new Pool({ connectionString: url })
  }
  return globalForPool.__zlPool
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS questions (
  id          SERIAL PRIMARY KEY,
  author_id   TEXT NOT NULL,
  author_name TEXT,
  subject     TEXT NOT NULL,
  ciphertext  TEXT NOT NULL,
  created_at  TIMESTAMP DEFAULT now()
);
CREATE TABLE IF NOT EXISTS exams (
  id             SERIAL PRIMARY KEY,
  title          TEXT NOT NULL,
  subject        TEXT NOT NULL,
  start_time     TIMESTAMPTZ NOT NULL,
  duration_min   INT DEFAULT 60,
  num_questions  INT DEFAULT 10,
  num_versions   INT DEFAULT 1,
  question_ids   INT[] DEFAULT '{}',
  status         TEXT DEFAULT 'locked',
  created_by     TEXT,
  created_at     TIMESTAMP DEFAULT now()
);
CREATE TABLE IF NOT EXISTS exam_students (
  exam_id     INT REFERENCES exams(id) ON DELETE CASCADE,
  student_id  TEXT,
  PRIMARY KEY (exam_id, student_id)
);
CREATE TABLE IF NOT EXISTS approvals (
  exam_id       INT REFERENCES exams(id) ON DELETE CASCADE,
  committee_id  TEXT,
  action        TEXT DEFAULT 'open',
  approved_at   TIMESTAMP DEFAULT now(),
  PRIMARY KEY (exam_id, committee_id, action)
);
CREATE TABLE IF NOT EXISTS submissions (
  exam_id      INT REFERENCES exams(id) ON DELETE CASCADE,
  student_id   TEXT,
  answers      JSONB,
  submitted_at TIMESTAMP DEFAULT now(),
  PRIMARY KEY (exam_id, student_id)
);
CREATE TABLE IF NOT EXISTS grades (
  exam_id     INT REFERENCES exams(id) ON DELETE CASCADE,
  student_id  TEXT,
  score       NUMERIC,
  status      TEXT DEFAULT 'draft',
  PRIMARY KEY (exam_id, student_id)
);
CREATE TABLE IF NOT EXISTS grade_change_requests (
  id           SERIAL PRIMARY KEY,
  exam_id      INT, student_id TEXT,
  old_score    NUMERIC, new_score NUMERIC,
  reason       TEXT, requested_by TEXT,
  approvers    TEXT[] DEFAULT '{}',
  status       TEXT DEFAULT 'pending',
  created_at   TIMESTAMP DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id      SERIAL PRIMARY KEY,
  actor   TEXT, role TEXT,
  action  TEXT, target TEXT,
  result  TEXT,
  at      TIMESTAMP DEFAULT now()
);
-- Attachments: the object in S3 is ciphertext (<uuid>.bin); only metadata lives here
CREATE TABLE IF NOT EXISTS files (
  id          SERIAL PRIMARY KEY,
  question_id INT REFERENCES questions(id) ON DELETE CASCADE,
  s3_key      TEXT NOT NULL,
  file_name   TEXT, mime TEXT,
  size        INT,
  created_at  TIMESTAMP DEFAULT now()
);
-- Signed RelationshipAttestation policies (public, network-signed bytes - not secrets)
CREATE TABLE IF NOT EXISTS policies (
  name        TEXT PRIMARY KEY,
  policy_b64  TEXT NOT NULL,
  granted_by  TEXT,
  created_at  TIMESTAMP DEFAULT now()
);
`

async function migrate() {
  if (!globalForPool.__zlMigrated) {
    globalForPool.__zlMigrated = pool().query(SCHEMA).then(() => undefined)
  }
  return globalForPool.__zlMigrated
}

export async function sql<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  await migrate()
  const res = await pool().query(text, params as any[])
  return res.rows as T[]
}

export async function audit(actor: string, role: string, action: string, target: string, result: 'success' | 'denied') {
  try {
    await sql('INSERT INTO audit_logs (actor, role, action, target, result) VALUES ($1,$2,$3,$4,$5)', [actor, role, action, target, result])
  } catch (e) {
    console.error('audit failed', e)
  }
}
