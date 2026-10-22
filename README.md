[![Built with TideCloak](https://tide.org/badges/built-with-tidecloak.svg)](https://tide.org/tidecloak?utm_source=github&utm_medium=readme&utm_campaign=unlocked)

## Project overview

_A shared exam bank where the exam only appears at exam time, once a committee quorum agrees, so nobody can know it in advance._

Built with [TideCloak](https://tide.org/tidecloak?utm_source=github&utm_medium=readme&utm_campaign=unlocked).

### 1. Vision & originality

A question bank that many lecturers, and eventually many schools, fill together while nobody holds the whole exam. Questions are sealed in the author's browser. At exam time a quorum opens it, the server draws questions without reading them, and each student gets a personal, watermarked version.

### 2. Trust constraint insight

Today the exam always sits with someone: an author, a secretary, a sysadmin. One bribed or hacked person and it leaks (cf. Vietnam's 2018 exam scandals). Even "encrypted, needs approvals" software has an admin who can read the database or flip a status, so schools don't share banks. Without a single point of control, pooling becomes safe.

### 3. Value & impact

Schools pool banks instead of writing their own. Lecturers contribute without becoming leak suspects, and students get a fair exam. Example: a national exam that no ministry official can see before the committee opens it.

### 4. Why TideCloak matters

TideCloak is the authority layer. BYOiD login leaves no passwords to steal. Every page and API route checks a TideCloak-verified token and role. Students' decryption right (`_tide_decryptor`) is a Quorum-Enforced Governance change request that committee members sign in the Tide enclave; the IT admin's self-grant stays pending. Bank encryption is simulated with an app key, as the brief allows (see [How TideCloak is applied](#how-tidecloak-is-applied)).

### 5. Prototype & storytelling

1. A lecturer submits a question they can never read back.
2. The admin sees only ciphertext; decrypt, self-grant and force-open are denied and logged.
3. At 1/2 approvals the exam stays locked; at 2/2 the questions are drawn.
4. The student decrypts a personal, watermarked version.

Demo video: [`RMIT_HUST_HNI_Bakhi_C2.mp4`](RMIT_HUST_HNI_Bakhi_C2.mp4)

## Setup

Requirements: Node 20+, Docker, Git Bash (for the realm script), a Postgres database (Neon or local) and, for attachments, S3-compatible storage.

```bash
# 1. TideCloak
docker run --name mytidecloak -d -p 8080:8080 \
  -e KC_BOOTSTRAP_ADMIN_USERNAME=admin -e KC_BOOTSTRAP_ADMIN_PASSWORD=<choose one> \
  tideorg/tidecloak-dev:latest

# 2. Realm: roles and demo users come from exam-vault/init/realm.json
cd exam-vault && npm install
NEW_REALM_NAME=zlexam SUBSCRIPTION_EMAIL=<your licence email> KC_PASSWORD=<admin password> bash init/tcinit.sh
#    Open the printed enrollment links (one private window each), first admin last.
#    This writes tidecloak.json (the adapter config).

# 3. Environment
cp .env.example .env.local   # DATABASE_URL, NEXT_PUBLIC_QUORUM, AWS_* and S3_BUCKET
npm run dev                  # http://localhost:3000

# 4. Smoke test (with the app running)
npm run test:smoke           # every API route refuses a missing or forged token
```

- Database tables are created automatically on first use.
- The exam-bank key pair is generated on first use in `exam-vault/.bank-key.json` (git-ignored). Keep it: everything sealed with it becomes unreadable if it is lost.
- Demo accounts: `lecturer1` (lecturer), `lecturer2` (IT admin), `committee2` (committee chair, holds `tide-realm-admin`), `committee3` (committee) and `student1` (student). In the UI, `committee2`/`committee3` are shown as committee1/committee2 (`lib/names.ts`). Use one browser profile per account and allow popups for the Tide enclave.

---

## How this meets the UNLOCKED brief

The brief asks: *"What would you build if trust stopped being the bottleneck?"* It asks for a small working prototype with TideCloak integrated, "where no single administrator, organisation or AI can unilaterally override the rules protecting people's data and decisions", and it says "TideCloak should change what it can credibly do."

| Brief requirement | How we meet it |
|---|---|
| One possibility held back by trust | Shared exam banks. Schools don't pool questions today because someone always holds the whole paper. |
| Working prototype with TideCloak integrated | Next.js 16 app on `@tidecloak/nextjs`, against a live TideCloak realm (`zlexam`). Login, roles, token checks and quorum governance run through TideCloak. |
| No single administrator can override the rules | No code path opens an exam without the committee quorum: `force-open` always returns 403. Votes are counted one per verified committee user. Decryption rights for students go through TideCloak change requests signed in the Tide enclave. The IT admin's self-grant attempt cannot be approved. Every denial is written to the audit log. |
| Show why removing unilateral control makes it possible | The demo walks through the attacks a single admin would use (read the DB, decrypt, self-grant, force-open), shows each one fail, then shows the quorum opening the exam. |
| Deliverables | Public repo with code, this README (overview and five prompts first, setup in its own section) and the demo video `RMIT_HUST_HNI_Bakhi_C2.mp4` (about 81 MB, under the 100 MB limit). |

| Judging criterion | Why the project fits | Where to see it |
|---|---|---|
| Vision & originality (25%) | The point is not a safer exam portal: it is a bank nobody can know in full, which makes sharing across schools possible at all. Draw on encrypted IDs, per-student versions and watermarks make even an author's own questions of little use to leak. | `lib/exams.ts` (draw with `crypto.randomInt`, seeded per-student order), `app/exam/page.tsx` (watermark) |
| Trust constraint insight (20%) | We name the real weakness, the admin who can read the database or flip a status, rather than an outside hacker. We also say plainly what no technology fixes: authors remembering their own questions. | Overview §2, [Honest limitations](#honest-limitations) |
| Value & impact (20%) | Pooled banks across faculties and schools, lecturers protected from suspicion, fairer exams, and a path to national exams. | Overview §3 |
| Why TideCloak matters (20%) | The authority to open an exam is spread across the committee and checked by TideCloak, not held by our server or our admin. | [How TideCloak is applied](#how-tidecloak-is-applied) |
| Prototype & storytelling (15%) | Four role pages tell the story end to end, with every denial visible on screen and in the audit log. | Demo video, `app/{contributor,committee,exam,admin}` |

## How TideCloak is applied

| TideCloak capability | How the app uses it | Code | Status |
|---|---|---|---|
| BYOiD login | Every user signs in with their own Tide account. There are no passwords in our database, so nobody can impersonate a committee member. | `app/layout.tsx` (`TideCloakProvider`), `tidecloak.json` | Live |
| Server-side token checks | Each API route verifies the TideCloak-signed JWT and the caller's realm role before doing anything. Wrong-role calls are logged as denied. Role pages are also gated on the server. | `lib/auth.ts` (`verifyTideCloakToken`), `proxy.ts` (`createTideCloakProxy`) | Live |
| Roles held in TideCloak | `contributor`, `committee`, `student` and `admin` are realm roles in TideCloak, not rows in our database. | `init/realm.json` | Live |
| Quorum-Enforced Governance (IGA) | When the committee votes to open an exam, the chair's browser files a change request to grant `_tide_decryptor` to that exam's students and signs it in the Tide enclave. Closing revokes it the same way. The IT admin's self-grant becomes a pending change request that they cannot approve. | `lib/tide/govern.ts` (`requestDecryptorChange`, `approveRequests`), `app/committee/page.tsx`, `app/admin/page.tsx` | Live |
| Policy-based E2EE (Tide network) | Questions encrypted and decrypted through Tide's built-in `RelationshipAttestation:1` contract, with "lecturers may only encrypt" and "students may only decrypt" policies. Items sealed this way still open through the Tide network. | `lib/tide/relationship.ts`, `lib/vault.ts` | Built, replaced by the simulation below for new items |
| Encryption of new items (simulated) | Questions and files are sealed in the browser (AES-GCM, key wrapped with the bank's RSA-OAEP public key). Lecturers only ever get the public key. A student gets the private key only for an open exam they are registered for. This stands in for Tide's E2EE, as the brief allows. | `lib/vault.ts`, `lib/bankKey.ts`, `app/api/bank-key/route.ts` | Simulated |
| Forseti time-lock | Decrypt only after the start time, even with quorum. | - | Roadmap |

**What the simulation changes.** With Tide's E2EE, no single party ever holds the bank key. In this build the server holds it in `.bank-key.json` and releases it based on the exam status in the database. Two things follow. The database and bucket still hold only ciphertext, so a dump is useless. But whoever controls the server's files, or can edit `exams.status`, could obtain the key. That is exactly the gap Tide's E2EE closes, and it is the first item on the roadmap.

## How it works

```
Browser                       Next.js app (server)              Storage
 ├─ Tide login (BYOiD)         ├─ verifies TideCloak JWT + role   ├─ Neon Postgres: ciphertext,
 ├─ seals / opens questions    │  on every page and API route     │  exams, votes, audit log
 └─ committee signs IGA        ├─ draws questions by ID only      └─ S3 (Neon Storage):
    change requests (enclave)  └─ releases bank key only for         exam-files/<uuid>.bin
              │                    an open exam
              ▼
 TideCloak (realm roles, IGA quorum governance)  ──►  Tide Cybersecurity Fabric
```

| Role | Can | Cannot |
|---|---|---|
| **Lecturer** | Submit multiple-choice or PDF/image questions, sealed in the browser. See metadata and per-subject counts only. | Read any question back, including their own |
| **Exam committee** | Create exams, vote to open or close, sign the TideCloak change request for students' decryption right, read the audit log | Open an exam alone |
| **Student** | Open their exam once the quorum has approved it, in a personal version with a watermark, then submit answers | See the exam before it opens, after it closes, or any exam they are not registered for |
| **IT admin** | See raw database rows and S3 objects, manage users, read the audit log | Decrypt, self-grant decryption, force-open (all denied and logged) |

**Exam lifecycle:** `locked → pending (first vote) → open (quorum reached: questions drawn) → closed (quorum vote or end of exam time)`. The quorum is set by `NEXT_PUBLIC_QUORUM` (2 in the demo).

## Code map

| Path | What |
|---|---|
| `exam-vault/app/{contributor,committee,exam,admin}` | Role pages |
| `exam-vault/app/api/**` | API routes. Each one verifies the JWT and role on the server (`lib/auth.ts`). |
| `exam-vault/app/api/bank-key/route.ts` | Gives out the bank's public key (lecturers, committee) or private key (student, open exam only) |
| `exam-vault/lib/vault.ts`, `lib/bankKey.ts` | Browser-side seal/open and the server's bank key pair |
| `exam-vault/lib/tide/govern.ts` | TideCloak IGA change requests: file, list, approve in the enclave |
| `exam-vault/lib/tide/relationship.ts` | Tide policy-based encryption (`RelationshipAttestation:1`) |
| `exam-vault/lib/exams.ts` | Random draw, per-student versions, exam status by time |
| `exam-vault/proxy.ts` | Page-level role gates |
| `exam-vault/scripts/smoke-test.mjs` | Automated check that every API route refuses missing or forged tokens |

## Roadmap

Replace the simulated bank key with Tide's policy-based E2EE, so the key is never whole anywhere · cross-school banks · Forseti time-lock (decrypt only after `start_time`, even with quorum) · invisible watermarking · tamper-proof gradebook (grade changes need three signatures) · direct-to-S3 presigned uploads · national-exam pilot.
