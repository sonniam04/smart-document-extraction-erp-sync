# Tasks

> โค้ด service อยู่ใน `Service/` (repo `sdes-service`), โค้ด web อยู่ใน `Web/` (repo `sdes-web`) งาน web ในกลุ่ม 7 ใช้ component จาก change `phase1-design-system` (tasks กลุ่ม 3 ของ change นั้นต้องเสร็จก่อน)

## 1. Scaffold `sdes-service`

- [x] 1.1 สร้าง pnpm workspace `apps/api`, `apps/worker`, `packages/core`, `packages/db` พร้อม TypeScript strict, ESLint, Prettier, Vitest — ตรวจด้วย `pnpm -r lint && pnpm -r typecheck && pnpm -r test` ผ่านบนโปรเจกต์ว่าง
- [x] 1.2 เขียน `docker-compose.yml` (postgres:16, redis:7 AOF, SeaweedFS (S3), clamav, api, worker) พร้อม healthcheck และ `.env.example` (ไม่มี secret จริง) — ตรวจด้วย `wsl docker compose up -d` แล้วทุก service เป็น healthy
- [x] 1.3 API เปิด `GET /health` (ตรวจ DB, Redis, S3, clamd) และ Swagger ที่ `/docs` — ตรวจด้วย e2e test ที่ได้ 200 และ `/docs-json` มี path `/health`
- [x] 1.4 GitHub Actions: install → lint → typecheck → test (service containers postgres/redis) → build — ตรวจด้วยการ push branch แล้ว workflow เขียว

## 2. Data model และ migration (`packages/db`)

- [x] 2.1 Prisma schema ตาม design D3 (users, user_roles, refresh_tokens, documents, document_extractions, document_status_history, vendors, settings, erp_sync_attempts, audit_events) ยอดเงินเป็น `NUMERIC(18,2)` — ตรวจด้วย `prisma migrate dev` สำเร็จบน DB ว่าง
- [x] 2.2 Migration SQL ดิบ: role `sdes_owner`/`sdes_app`, sequence `doc_no`, partial unique index `sha256 WHERE status <> 'FAILED'`, trigger + REVOKE บน `audit_events` — ตรวจด้วย integration test ว่า `sdes_app` สั่ง UPDATE/DELETE `audit_events` แล้วถูกปฏิเสธ
- [x] 2.3 Seed System Admin คนแรกจาก env (รหัสผ่านชั่วคราว) และ settings เริ่มต้น (`risk.confidence_threshold=0.85`) — ตรวจด้วย test ว่า seed รันซ้ำได้โดยไม่สร้างข้อมูลซ้ำ
- [x] 2.4 เขียน `Service/docs/data-model.md` (ER diagram + คำอธิบายตาราง) — ตรวจว่าทุกตารางใน schema มีคำอธิบาย

## 3. Domain core (`packages/core`)

- [x] 3.1 State machine: รายการสถานะ, transition ที่อนุญาต และผู้มีสิทธิ์ ตาม spec `document-lifecycle` — ตรวจด้วย unit test ครอบทุก transition ที่อนุญาตและตัวอย่างที่ไม่อนุญาต (เช่น `EXTRACTED→SYNCING`, ออกจาก `SYNCED`)
- [x] 3.2 Permission matrix 4 role ตาม spec `user-access` — ตรวจด้วย unit test ตาราง role × action ครบทุกช่อง
- [x] 3.3 Interface `ExtractionProvider`, `ErpAdapter` และ `FakeExtractionProvider` — ตรวจด้วย unit test ว่า fake คืนผลที่มีรูปตรง type
- [x] 3.4 Redactor สำหรับ audit (ตัด password/token/secret, mask เลขบัตรประชาชน/เลขบัญชี) — ตรวจด้วย unit test กรณีซ้อน object/array

## 4. Audit trail (`apps/api`)

- [x] 4.1 `AuditService.record(tx, event)` เขียนใน transaction เดียวกับการกระทำ — ตรวจด้วย integration test ว่าเมื่อเขียน audit ล้มเหลว การกระทำถูก rollback
- [x] 4.2 `GET /audit-events` พร้อมตัวกรอง (ช่วงเวลา, ผู้กระทำ, ประเภท, เอกสาร) จำกัด role `FINANCE_EXEC`/`SYS_ADMIN` และไม่มี endpoint แก้/ลบ — ตรวจด้วย e2e: Exec ได้ 200, Clerk ได้ 403, PUT/DELETE ได้ 404/405

## 5. Auth และการจัดการผู้ใช้ (`apps/api`)

- [x] 5.1 Login (argon2id), ข้อความผิดพลาดกลาง, ล็อก 15 นาทีเมื่อผิด 5 ครั้ง, audit event — ตรวจด้วย e2e ทุก scenario ใน requirement Password sign-in และ Brute-force protection
- [x] 5.2 Access token 15 นาที + refresh token หมุนเวียนใน cookie HttpOnly, revoke ทั้ง family เมื่อใช้ซ้ำ, logout — ตรวจด้วย e2e scenario ของ Session lifetime
- [x] 5.3 บังคับเปลี่ยนรหัสผ่านชั่วคราว — ตรวจด้วย e2e ว่าคำขออื่นได้ 403 จนกว่าจะเปลี่ยนรหัส
- [x] 5.4 Guard ตรวจ role จาก permission matrix ใน core — ตรวจด้วย e2e ตัวอย่าง: Exec แก้ข้อมูลได้ 403, Admin อัปโหลดได้ 403
- [x] 5.5 Admin API: สร้าง/แก้ role/ปิด-เปิดใช้งาน/รีเซ็ตรหัสผ่าน และกันการปิด Admin คนสุดท้าย พร้อม audit ก่อน/หลัง — ตรวจด้วย e2e ทุก scenario ของ User administration

## 6. Ingestion POC (`apps/api` + `apps/worker`)

- [x] 6.1 `POST /documents` รับหลายไฟล์แบบ stream ลง temp ตัดที่ 20MB ตรวจ magic bytes — ตรวจด้วย e2e: PDF/TIFF/JPG/PNG ผ่าน, 21MB และ exe ที่เปลี่ยนนามสกุลถูกปฏิเสธพร้อมเหตุผล, ชุด 5 ไฟล์ที่มีไฟล์เสียได้ผลรายไฟล์
- [x] 6.2 สแกน clamd แบบ fail closed — ตรวจด้วย e2e: ไฟล์ EICAR ถูกปฏิเสธและมี audit, หยุด clamav แล้วการอัปโหลดถูกปฏิเสธ
- [x] 6.3 SHA-256 + ตรวจซ้ำพร้อมแจ้ง `doc_no` เดิม — ตรวจด้วย e2e: ไฟล์เดิมซ้ำถูกปฏิเสธ, ไฟล์ของเอกสาร `FAILED` อัปโหลดซ้ำได้
- [x] 6.4 เก็บต้นฉบับใน S3 (SSE) + insert เอกสาร/history/audit ใน transaction + enqueue (jobId = document id) และ `GET /documents/:id/file` ให้ลิงก์ 5 นาที — ตรวจด้วย e2e ว่า hash ของไฟล์ที่ดาวน์โหลดตรงกับตอนอัปโหลด และ `SYS_ADMIN` ได้ 403
- [x] 6.5 Worker job "extract" ใช้ `FakeExtractionProvider` เปลี่ยน `UPLOADED→PROCESSING→EXTRACTED` (หรือ `FAILED`) ด้วย optimistic lock — ตรวจด้วย integration test รวมกรณีสองคำขอเปลี่ยนสถานะชนกันได้ 409 หนึ่งคำขอ
- [x] 6.6 `POST /documents/:id/retry` (อ่านใหม่) สำหรับ `FAILED→PROCESSING` — ตรวจด้วย e2e
- [x] 6.7 Reconciler ทุก 1 นาที enqueue เอกสาร `UPLOADED` ที่ค้างเกิน 2 นาที — ตรวจด้วย integration test ที่ลบ job ทิ้งแล้วเอกสารยังถูกประมวลผล
- [x] 6.8 WebSocket gateway (socket.io + Redis pub/sub) ส่งการเปลี่ยนสถานะ และ `GET /documents` สำหรับ resync หลังหลุด — ตรวจด้วย e2e ที่ client ได้ event ภายใน 3 วินาที
- [x] 6.9 `GET /documents/:id` พร้อมประวัติสถานะเรียงตามเวลา — ตรวจด้วย e2e
- [x] 6.10 Load test k6: อัปโหลดพร้อมกัน 50 ไฟล์ × 5MB — ตรวจว่าทุกไฟล์ได้ 201 และเข้าคิว เก็บสคริปต์ไว้ที่ `Service/load/upload.k6.js` และผลไว้ที่ `qa/phase1/load-upload.md` (repo หลัก)

## 7. `sdes-web` foundation

- [x] 7.1 Scaffold Next.js App Router + Tailwind + Vitest + Playwright + ESLint ต่อ token/component จาก `phase1-design-system` และ GitHub Actions (lint → typecheck → test → build) — ตรวจด้วย workflow เขียว
- [x] 7.2 API client + การจัดการ token (access ใน memory, refresh อัตโนมัติ) และ route guard ตาม role — ตรวจด้วย unit test ของ client กรณี 401 → refresh → retry
- [x] 7.3 หน้า `/login` และหน้าเปลี่ยนรหัสผ่านชั่วคราว — ตรวจด้วย Playwright: ล็อกอินสำเร็จ, รหัสผิด, บังคับเปลี่ยนรหัส
- [x] 7.4 หน้า `/documents`: อัปโหลดหลายไฟล์ (ลากวาง), ผลรายไฟล์, ตารางคิวพร้อมสถานะ real-time และปุ่ม "อ่านใหม่" สำหรับ `FAILED` — ตรวจด้วย Playwright กับ stack จริง: อัปโหลดแล้วเห็นสถานะเปลี่ยนเป็น `EXTRACTED` โดยไม่รีเฟรช
- [x] 7.5 หน้า `/admin/users`: รายชื่อ, สร้าง, เปลี่ยน role, ปิด/เปิดใช้งาน, รีเซ็ตรหัสผ่าน — ตรวจด้วย Playwright และเมนูนี้ไม่แสดงสำหรับ role อื่น

## 8. Integration check

- [x] 8.1 E2E ตลอดสาย: Admin สร้าง Clerk → Clerk ล็อกอิน/เปลี่ยนรหัส → อัปโหลด 3 ไฟล์ (1 ซ้ำ) → เห็นสถานะ real-time → Exec เห็น audit ของทุกขั้น — ตรวจด้วย Playwright suite ใน `qa/` ที่รันกับ `docker compose up`
- [ ] 8.2 เขียน `Service/README.md` และ `Web/README.md` (วิธีรัน dev, env ที่ต้องมี, คำสั่ง test) — ตรวจโดยรันตาม README บนเครื่องที่ clone ใหม่แล้วได้ระบบที่ใช้งานได้

## Workflow follow-up

- รีวิวผลกับผู้ใช้ แล้ว archive change นี้ด้วย `/opsx:archive` เพื่อย้าย spec เข้า `openspec/specs/`
