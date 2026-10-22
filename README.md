# Zero-Leak Exam Vault

> A shared exam bank where the exam only *appears* at exam time, once enough of the committee agrees. Nobody knows it in advance - not the authors, not the IT admin, not the server, not the cloud.

**UNLOCKED Hackathon - Challenge 2 (RMIT Hackathon 2026) · built on TideCloak**

---

## The pitch (judging criteria)

**Vision & originality.** A question bank that many lecturers - even many schools - fill together, where *no single person ever holds the whole exam*. Questions are encrypted in the author's browser; at exam time a committee quorum opens the vault, the server draws a random subset *without being able to read it*, and every student gets a personal, watermarked version.

**Trust constraint insight.** Today the exam always sits in someone's hands: an author, a secretary, a sysadmin, a print shop. One bribed or hacked person and it leaks (cf. Vietnam's 2018 national-exam score scandals). Even "encrypted, needs 3 approvals" software has an admin who can read the DB, edit the code or flip a status to *approved*. So schools never dare to share question banks.

**Value & impact.** Schools can pool question banks across faculties and institutions; lecturers contribute without becoming leak suspects; students get a fair exam; national exams lose their single points of failure.

**Why TideCloak matters.** Remove TideCloak and the admin can read and open the exam. With it: questions are end-to-end encrypted, the key exists only as shards on the Tide Cybersecurity Fabric, *encrypt* and *decrypt* rights are separated, and the decrypt right is granted only through a quorum-signed change request. The promise changes from "trust us" to "we can't, even if we wanted to".

**Prototype & storytelling.** Lecturer submits → admin sees only ciphertext and is denied → committee approves 1/2, 2/2 → questions are drawn → the student decrypts their own watermarked version.

---

## How it works

```
Browser (Tide enclave)        Next.js app (server)            Storage
 ├─ login (BYOiD)              ├─ verifies JWT + role on        ├─ Neon Postgres: ciphertext,
 ├─ encrypt / decrypt here     │  every API route               │  exams, votes, audit log
 └─ committee signs IGA        ├─ never sees plaintext          └─ S3 (Neon Storage):
    change requests            └─ draws questions by ID only       exam-files/<uuid>.bin
              │
              ▼
 TideCloak (IGA, quorum governance)  ──►  Tide Cybersecurity Fabric (ORKs, threshold keys)
```

| Role | Can | Cannot |
|---|---|---|
| **Lecturer** | Submit multiple-choice or PDF/image questions, encrypted in the browser; see metadata only | Read any question back, including their own |
| **Exam committee** | Create exams, vote to open/close, sign the Tide change request granting students `_tide_decryptor` | Open an exam alone |
| **Student** | Decrypt their exam once the quorum has signed; personal version + watermark; submit | See the exam before it opens or after it closes |
| **IT admin** | See raw DB rows and S3 objects, manage users | Decrypt, self-grant decryption, force-open (all denied and logged) |

**Encryption model.** Two network-signed policies on Tide's built-in `RelationshipAttestation:1` contract, both bound to the record tag `zl-exam-bank`:
- `contributor-write` - subject role `contributor`, encrypt only (a write-only drop box);
- `student-read` - subject role `student`, decrypt only, **and** the caller must hold realm role `_tide_decryptor`.

`_tide_decryptor` is granted to an exam's students only through a TideCloak IGA change request that must be signed in the Tide enclave by `tide-realm-admin` committee members. The app's own vote table only displays progress; editing the database to `status = open` grants no decryption.

**Exam lifecycle.** `locked → pending (1 vote) → open (quorum: questions drawn) → closed (quorum or time-out)`.

## Tech stack

Next.js 16 (App Router) · `@tidecloak/nextjs` 0.13 · TideCloak (`tideorg/tidecloak-dev`) · Neon Postgres (`pg`) · Neon Storage / S3 (`@aws-sdk/client-s3`) · Tide MCP (Raziel) + Claude Code.

## Run it locally

```bash
# 1. TideCloak
docker run --name mytidecloak -d -p 8080:8080 \
  -e KC_BOOTSTRAP_ADMIN_USERNAME=admin -e KC_BOOTSTRAP_ADMIN_PASSWORD=<choose one> \
  tideorg/tidecloak-dev:latest

# 2. Realm (roles + demo users are in exam-vault/init/realm.json)
cd exam-vault && npm install
NEW_REALM_NAME=zlexam SUBSCRIPTION_EMAIL=<your licence email> KC_PASSWORD=<admin password> bash init/tcinit.sh
#    open the printed enrollment links (one private window each), first admin last

# 3. Environment
cp .env.example .env.local   # DATABASE_URL, AWS_* and S3_BUCKET, NEXT_PUBLIC_QUORUM
npm run dev                  # http://localhost:3000
```

Tables are created automatically on first use. One-time setup: the committee chair opens **Committee → Exam bank setup** and signs both policies.

## Code map

| Path | What |
|---|---|
| `exam-vault/app/{contributor,committee,exam,admin}` | Role pages |
| `exam-vault/app/api/**` | API routes - each verifies the JWT and role server-side (`lib/auth.ts`) |
| `exam-vault/lib/tide/relationship.ts` | Policy signing, `encryptForRecord` / `decryptForRecord` |
| `exam-vault/lib/tide/govern.ts` | IGA change requests: file, list, enclave-approve |
| `exam-vault/lib/tide/files.ts` | Browser-side encryption of attachments |
| `exam-vault/lib/exams.ts` | Random draw (crypto `randomInt`), per-student versions |
| `exam-vault/proxy.ts` | Page-level role gates |

## Honest limitations

- **Free-tier licence.** Our realm allowed only five linked Tide accounts, so the demo committee has two members and the app quorum is 2/2 (`NEXT_PUBLIC_QUORUM`); the design targets 3/5. Committee users are shown under display aliases (`lib/names.ts`).
- **One Tide signer.** Only one committee member holds `tide-realm-admin`, so the Tide threshold is 1. Granting the role to more members raises it (TideCloak derives ~70% of admins).
- **Login outage at submission time.** Late on submission day every login to our local realm failed at Tide's token signing (`TidecloakSessionStartTokenSign:1 – Not enough orks returned an ok response`, ORKs returning HTTP 500) after the clock was verified in sync; it is reported to the Tide team. Enrollment, licensing and IGA governance worked earlier the same day.
- A student holding `_tide_decryptor` could technically decrypt any bank ciphertext they obtain; the server only serves the drawn questions, and only while the exam is open.
- No technology stops an author from remembering their own questions - hence a large shared bank, a random draw and per-student versions.
- Not defended: a full colluding quorum; malware on a student's device.

## Roadmap

Cross-school banks · Forseti time-lock (decrypt only after `start_time`, even with quorum) · invisible watermarking · full tamper-proof gradebook (grade changes need 3 signatures) · direct-to-S3 presigned uploads · national-exam pilot.
