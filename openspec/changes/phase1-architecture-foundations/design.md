# Design

## Context

โปรเจกต์เริ่มจากศูนย์ (greenfield) มี 3 repo: repo หลัก `smart-document-extraction-erp-sync` (docs, qa, openspec), `sdes-service` (โฟลเดอร์ `Service/`) และ `sdes-web` (โฟลเดอร์ `Web/`) Stack ถูกกำหนดโดย BRD ข้อ 7 แล้ว: Next.js App Router + Tailwind + PDF.js, NestJS (REST + WebSocket + Swagger), BullMQ/Redis, PostgreSQL 16 (JSONB), S3-compatible storage

ข้อตัดสินใจจาก explore (2026-10-29) ที่เป็นกรอบของ design นี้: รันบน cloud และใช้ AI ผ่าน API ที่สลับ provider ได้, role 4 แบบ, เคสไม่เสี่ยง auto-sync หลัง Clerk ยืนยัน, ตรวจยอดสองชั้น (WHT อยู่ชั้นที่ 2), ERP ผ่าน Generic Webhook + HMAC โดยใช้ Odoo ทดสอบ, ล็อกอินในระบบด้วย JWT ที่ต่อ OIDC ได้ภายหลัง ดู flow ที่ https://claude.ai/artifact/AFUz11ML9Ckoy3MSqFpuHj

## Goals / Non-Goals

**Goals:**
- โครงสร้างโค้ดที่ Phase 2–4 เติม feature ได้โดยไม่ต้องย้ายหรือรื้อ module
- Data model ครบทั้งวงจรตั้งแต่วันแรก (รวม field ภาษี/ยอดเงินที่ Phase 2 จะใช้) เพื่อลด migration ที่เปลี่ยนโครงสร้างภายหลัง
- POC ingestion ที่รันได้จริงตั้งแต่อัปโหลดจนเอกสารถึง `EXTRACTED` ด้วย provider จำลอง
- ทุกอย่างรันในเครื่องได้ด้วย `docker compose up` คำสั่งเดียว

**Non-Goals:**
- Infrastructure สำหรับ production (เลือก cloud, IaC, monitoring) — Phase 4
- AI provider จริง, PII masking จริง, กฎตรวจยอด — Phase 2
- ERP adapter จริง, การลงลายเซ็น payload, retry/DLQ ของการ sync — Phase 3
- OIDC/SSO — ออกแบบให้เพิ่มได้ แต่ไม่ทำใน phase นี้

## Decisions

### D1. โครงสร้าง `sdes-service`: pnpm workspace แยก API กับ worker
```
Service/
  apps/api        NestJS HTTP + WebSocket gateway + Swagger
  apps/worker     NestJS standalone app ประมวลผลคิว BullMQ
  packages/core   domain ล้วน: state machine, permission matrix, ประเภทข้อมูล, interface provider/adapter
  packages/db     Prisma schema, migrations (รวม SQL ดิบสำหรับ trigger/grant), client
  docker-compose.yml, .env.example
```
- **เหตุผล:** API กับ worker scale แยกกันได้ (worker กิน CPU/เวลาจาก AI call) แต่ใช้ domain logic ชุดเดียวกัน กติกา state/permission อยู่ใน `packages/core` ที่ไม่ผูกกับ framework จึง unit test ได้ตรง
- **ทางเลือกที่ไม่เลือก:** Nest monorepo mode (ผูกกับ Nest CLI มากเกิน), แยก worker เป็น repo ที่สาม (เพิ่มภาระ sync type ข้าม repo)

### D2. ORM: Prisma + SQL ดิบใน migration
- Prisma ให้ type-safety และ migration ที่อ่านง่าย ส่วนที่ Prisma ทำเองไม่ได้ (trigger กันแก้ audit, `REVOKE`, partial unique index, CHECK constraint ของ state) เขียนเป็น SQL ใน migration ไฟล์เดียวกัน
- **ทางเลือกที่ไม่เลือก:** TypeORM (migration อ่อน, type หลวม), Drizzle (ดีแต่ทีมคุ้นน้อยกว่า และ Nest ecosystem รองรับน้อยกว่า)

### D3. Data model หลัก
| ตาราง | สาระสำคัญ |
|---|---|
| `users`, `user_roles` | อีเมล unique, `password_hash` (argon2id), `is_active`, `failed_login_count`, `locked_until`; role เป็น enum 4 ค่า หลาย role ต่อคนได้ |
| `refresh_tokens` | เก็บเฉพาะ hash, `family_id` สำหรับตรวจการใช้ซ้ำ, `revoked_at`, `expires_at` |
| `documents` | `id` (uuid), `doc_no` (`DOC-000123` จาก sequence), `status` (enum), `sha256`, ชนิด/ขนาด/ชื่อไฟล์, `storage_key`, `uploaded_by`, `version` (optimistic lock), `provider`, `model_version`, `confidence`, `risk_flags` (jsonb) และ field ภาษี: `invoice_no`, `invoice_date`, `vendor_id`, `buyer_tax_id`, `subtotal`, `discount`, `vat_base`, `vat_rate`, `vat_amount`, `vat_exempt`, `grand_total`, `wht_base`, `wht_rate`, `wht_amount`, `net_payable` (ฐาน WHT แยกจากฐานภาษี เพราะใบเดียวอาจมีทั้งสินค้าที่ไม่หักและบริการที่หัก — ยืนยันจาก wireframe 2026-10-29) |
| `document_extractions` | ผลดิบจาก provider ต่อรอบ (`raw` jsonb), `items` jsonb (ลำดับ, รายการ, จำนวน, ราคาต่อหน่วย, ภาษี, ยอดสุทธิ, bbox, confidence) |
| `document_status_history` | from/to, actor (user หรือ `system`), reason, เวลา |
| `vendors` | `tax_id` (13 หลัก) + `branch_code` unique, ชื่อ |
| `settings` | key/value jsonb เช่น `risk.confidence_threshold=0.85`, `risk.high_amount_threshold` |
| `erp_sync_attempts` | สร้างโครงไว้สำหรับ Phase 3 |
| `audit_events` | append-only (ดู D7) |

- ยอดเงินใช้ `NUMERIC(18,2)` และ `Decimal` ในโค้ด ห้ามใช้ float
- เวลาเก็บเป็น `timestamptz` (UTC) แสดงผลเป็น Asia/Bangkok
- กันไฟล์ซ้ำด้วย partial unique index `UNIQUE(sha256) WHERE status <> 'FAILED'` ซึ่งตรงกับข้อยกเว้นใน spec

### D4. State machine อยู่ใน `packages/core` และบังคับที่ DB ด้วย
- ตาราง transition (from, to, ผู้มีสิทธิ์) เป็นข้อมูลชุดเดียวที่ทั้ง API และ worker ใช้
- การเปลี่ยนสถานะทำด้วย `UPDATE ... WHERE id=? AND status=? AND version=?` ใน transaction เดียวกับการเขียน `document_status_history` และ `audit_events` ถ้าแถวที่ถูกอัปเดตเป็น 0 แปลว่ามีคนเปลี่ยนไปก่อน → 409 (spec: Concurrent transition safety)

### D5. Auth
- argon2id สำหรับรหัสผ่าน; access token เป็น JWT อายุ 15 นาที (เก็บใน memory ฝั่ง web); refresh token เป็น opaque random อายุ 8 ชั่วโมง ส่งใน cookie `HttpOnly; Secure; SameSite=Strict; Path=/auth`
- หมุน refresh token ทุกครั้งที่ใช้ ถ้าพบการใช้ token ที่ถูกหมุนไปแล้ว ให้ revoke ทั้ง `family_id`
- ตอน refresh ตรวจ `is_active` และ role ปัจจุบันจาก DB จึงทำให้การปิดใช้งาน/เปลี่ยน role มีผลภายในอายุ access token (≤15 นาที)
- Guard ของ Nest อ่าน permission matrix จาก `packages/core` เดียวกับที่ web ใช้ซ่อน/แสดงเมนู (web เป็นแค่ UX ส่วนการบังคับจริงอยู่ที่ server)
- **รองรับ OIDC ภายหลัง:** แยก `IdentityProvider` (local password ตอนนี้) และให้ `users` มี `external_subject` ที่ nullable ไว้แล้ว

### D6. เส้นทาง ingestion
```
web --multipart--> api /documents (stream ลง temp, ตัดที่ 20MB)
   -> ตรวจ magic bytes (file-type) -> clamd INSTREAM (timeout 30s, fail closed)
   -> sha256 -> ตรวจซ้ำ -> PutObject S3 (SSE AES-256, key originals/yyyy/mm/<uuid>)
   -> tx{ insert documents(UPLOADED) + history + audit } -> enqueue BullMQ "extract" (jobId = document id)
   -> ตอบ 201 {docNo, id}
worker "extract": UPLOADED->PROCESSING -> ExtractionProvider.extract() -> EXTRACTED | FAILED
           -> publish สถานะผ่าน Redis pub/sub -> api gateway -> socket.io -> web
```
- ใช้ jobId = document id เพื่อให้ enqueue ซ้ำได้อย่างปลอดภัย (idempotent)
- Redis เปิด AOF และมี **reconciler** ใน worker ทุก 1 นาที ที่ enqueue เอกสาร `UPLOADED` ซึ่งค้างเกิน 2 นาทีแล้วไม่มี job จึงไม่สูญหายแม้ commit DB แล้วแต่ enqueue ไม่สำเร็จ (spec: Processing hand-off)
- Phase 1 ใช้ `FakeExtractionProvider` ที่คืนผลว่างพร้อม `confidence=0` เพื่อพิสูจน์ว่าเส้นทางทำงานได้ตลอด
- **ทางเลือกที่ไม่เลือก:** อัปโหลดตรงจาก browser ไป S3 ด้วย presigned URL แม้ลดภาระ API แต่ทำให้สแกนไวรัสก่อนจัดเก็บถาวรยากกว่า และ 3,500 ฉบับ/เดือนไม่ใช่ภาระหนัก

### D7. Audit trail ที่แก้ไม่ได้
- `audit_events` มี trigger `BEFORE UPDATE OR DELETE ... RAISE EXCEPTION` และ `REVOKE UPDATE, DELETE, TRUNCATE` จาก role DB ของแอป (แอปใช้ role `sdes_app` ไม่ใช่ owner) migration รันด้วย role `sdes_owner` แยกต่างหาก
- เขียน audit ใน transaction เดียวกับการกระทำ (spec: Atomic recording) ผ่าน `AuditService.record(tx, event)`
- ค่าก่อน/หลังเก็บเป็น jsonb ผ่านตัว redact ที่ตัด key ต้องห้าม (`password`, `token`, `secret`) และ mask รูปแบบเลขบัตรประชาชน/เลขบัญชีธนาคาร

### D8. Interface ที่สลับ provider ได้ (ประกาศใน `packages/core`)
```ts
interface ExtractionProvider {
  readonly name: string;          // 'fake' | 'claude' | ...
  extract(input: { file: Buffer; mime: string; pages?: number }): Promise<ExtractionResult>;
}
interface ErpAdapter {
  readonly name: string;          // 'generic-webhook' | 'odoo' | ...
  push(payload: SignedErpPayload): Promise<{ transactionId: string }>;
  health(): Promise<boolean>;
}
```
เลือก implementation ผ่าน config (`EXTRACTION_PROVIDER`, `ERP_ADAPTER`) และบันทึก `provider`/`model_version` ลงเอกสารทุกครั้ง

### D9. `sdes-web`
- App Router: `/login`, `/documents` (อัปโหลด + คิว + สถานะ real-time), `/admin/users`
- เรียก API ตรง (โดเมนย่อยเดียวกัน, CORS เฉพาะ origin ของ web) ไม่ทำ BFF เพื่อไม่ให้มี auth สองชั้น
- Component มาจาก change `phase1-design-system`

### D10. เครื่องมือ
- Node 22 LTS, pnpm, TypeScript strict, ESLint + Prettier
- Vitest ทั้งสอง repo (Nest ใช้ผ่าน SWC), Supertest สำหรับ API, Playwright สำหรับ smoke test ของ web
- **CI (GitHub Actions ต่อ repo):** install → lint → typecheck → test (service ใช้ service containers postgres/redis) → build
- `docker-compose.yml` ใน `Service/`: postgres:16, redis:7 (AOF), minio, clamav, api, worker

## Risks / Trade-offs

- [Redis หายหรือ job ค้าง ทำให้เอกสารไม่ถูกประมวลผล] → jobId idempotent + reconciler ตาม D6 + AOF
- [ClamAV ใช้ RAM ~1–1.5 GB และโหลด signature ช้าตอนเริ่ม] → healthcheck ใน compose ให้ api รอ clamav พร้อม และยอมรับว่าเครื่อง dev ต้องมี RAM เพียงพอ
- [Prisma ไม่รู้จัก trigger/grant ที่เขียนด้วย SQL ดิบ อาจถูกลบเมื่อ reset] → ทุก SQL ดิบอยู่ในไฟล์ migration (ไม่ใช่ `db push`) และมี integration test ยืนยันว่า UPDATE/DELETE บน `audit_events` ถูกปฏิเสธ
- [รับไฟล์ผ่าน API ทำให้ API ต้องรับ 50 × 20MB พร้อมกัน] → stream ลงดิสก์ชั่วคราวแทน memory และทดสอบ 50 concurrent ใน Phase 1 (k6)
- [Partial unique index ทำให้อัปโหลดไฟล์เดิมของเอกสาร `FAILED` ได้ซ้ำ] → ตั้งใจตาม spec; ทางที่แนะนำคือกด "อ่านใหม่" ซึ่งไม่สร้างเอกสารใหม่
- [SSE บน MinIO ต้องตั้ง KMS] → dev ใช้ MinIO + auto-encryption ด้วย KES แบบ static key; production ใช้ SSE-S3/KMS ของ cloud

## Migration Plan

Greenfield ไม่มีข้อมูลเดิม Migration แรกสร้างทุกตาราง, role DB `sdes_owner`/`sdes_app`, trigger และ grant รวมถึง seed System Admin คนแรกจาก env (`SEED_ADMIN_EMAIL`, รหัสผ่านชั่วคราวที่บังคับเปลี่ยนตอนล็อกอินครั้งแรก) Rollback ใน dev คือ drop database แล้ว migrate ใหม่

## Open Questions

- Cloud provider สำหรับ production (AWS / GCP / Azure) — ตัดสินใน Phase 4 ไม่กระทบโค้ด Phase 1 เพราะใช้ S3 API มาตรฐาน
- ค่าเริ่มต้นของ `risk.high_amount_threshold` — รอฝ่ายบัญชี ใช้ใน Phase 2 (ตั้งเป็น setting แล้ว ไม่ต้องแก้โค้ด)
