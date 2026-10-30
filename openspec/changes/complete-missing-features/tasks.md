# Tasks

> แตก branch `feat/complete-missing-features` ต่อจาก `feat/phase3-erp-integration` ใน Service/Web และ `docs/complete-missing-features` ต่อจาก `docs/phase3-planning` ในรีโพหลัก จนกว่า PR ของ Phase 2–3 จะ merge

## 1. สิทธิ์และ data model

- [ ] 1.1 เพิ่ม permission `vendor.view` (AP_CLERK, AP_LEAD) และ `logs.view` (SYS_ADMIN) ใน `packages/core` แล้ว `pnpm sync:core` ไปเว็บ — ตรวจด้วย unit test ของ permission matrix ตาม spec `user-access` และ `pnpm sync:core --check` ผ่าน
- [ ] 1.2 Migration ตาม design D1, D2, D4 (`users.kind`, `api_keys`, `system_logs` + สิทธิ์ `sdes_app` ที่ไม่มี update บน `system_logs`) — ตรวจด้วย integration test: migrate บนฐานที่มีข้อมูลเดิมแล้วผู้ใช้เดิมเป็น `HUMAN`, `sdes_app` update `system_logs` ไม่ได้
- [ ] 1.3 ย้ายเงื่อนไข "ผู้ขายรายใหม่" เป็นฟังก์ชันกลางที่ `review.service` และทะเบียนผู้ขายใช้ร่วมกัน (design D5) — ตรวจด้วย test เดิมของการประเมินความเสี่ยงยังผ่าน
- [ ] 1.4 อัปเดต `Service/docs/data-model.md` — ตรวจว่าทุก column/ตารางใหม่มีคำอธิบาย

## 2. API keys (`apps/api`)

- [ ] 2.1 สร้าง/รายการ/เพิกถอน key + บัญชีบริการ (design D1–D3) — ตรวจด้วย e2e test ตาม spec `api-keys` "Issue API key", "API key storage", "Revoke API key" (ค่า key แสดงครั้งเดียว, ไม่มีในฐาน/audit, ไม่เลือกขอบเขตได้ 400, Clerk ได้ 403)
- [ ] 2.2 `AuthGuard` รับ key (`Bearer sdes_...` / `X-API-Key`) แปลงขอบเขตเป็น permission, อัปเดต `last_used_at` ไม่เกินนาทีละครั้ง — ตรวจด้วย e2e test: อัปโหลดด้วย key สำเร็จและผู้อัปโหลดคือ key, ขอบเขตอ่านอย่างเดียวอัปโหลดได้ 403, key หมดอายุ/ถูกเพิกถอนได้ 401, key แก้ข้อมูล/อนุมัติ/เรียก `/admin/*` ไม่ได้
- [ ] 2.3 บัญชีบริการล็อกอินด้วยรหัสผ่านไม่ได้ และไม่อยู่ใน `GET /admin/users`; audit ของการกระทำด้วย key แสดงชื่อ key — ตรวจด้วย e2e test ตาม spec `user-access` "Service accounts" และ `api-keys` "API key audit"
- [ ] 2.4 authorization regression test ครอบคลุมการเรียกด้วย key — ตรวจด้วย test ที่ไล่ทุก route ด้วย key แต่ละขอบเขต แล้วเทียบกับ permission ที่ขอบเขตนั้นให้

## 3. System logs (`packages/db`, `apps/api`, `apps/worker`)

- [ ] 3.1 `DbLogger` (design D4): stdout + คิว warn/error flush เป็นชุด, ปิดบังข้อมูล, ไม่ล้มเมื่อฐานล่ม — ตรวจด้วย unit test: redaction ของ Authorization/`sdes_...`/connection string/เลข 13 หลัก, คิวเต็มทิ้งรายการเก่า, flush ล้มเหลวไม่ throw
- [ ] 3.2 ใช้ `DbLogger` ใน api และ worker + งานลบ log เก่ากว่า 30 วันใน worker — ตรวจด้วย integration test: error ของ worker ค้นเจอภายใน 10 วินาทีพร้อม `service = worker`, งานลบเก็บ log ใหม่กว่า 30 วันไว้
- [ ] 3.3 `GET /admin/system-logs` ตัวกรองเวลา/ระดับ/บริการ/ข้อความ แบบ cursor — ตรวจด้วย e2e test ตาม spec `system-logs` "Log viewer" (เรียงใหม่ไปเก่า, Exec ได้ 403)

## 4. ทะเบียนผู้ขายและรายงาน (`apps/api`)

- [ ] 4.1 `GET /vendors` และ `GET /vendors/:id` (design D5) — ตรวจด้วย e2e test ตาม spec `vendor-directory`: ค้น Tax ID ได้ทุกสาขา, ยอดรวมไม่นับ `REJECTED`, ป้ายผู้ขายรายใหม่, Admin ได้ 403
- [ ] 4.2 `GET /reports/summary` (design D6) — ตรวจด้วย e2e test ตาม spec `finance-reports`: ตัดเอกสารที่ถูกปฏิเสธ, ยอดรวมเท่าผลรวมรายเดือนแบบทศนิยม 2 ตำแหน่ง, จัดช่วงตามวันที่ในใบกำกับ/วันที่อัปโหลดในเวลาไทย, สัดส่วนไม่ต้องแก้ 75% จากข้อมูลตัวอย่าง, ช่วง 30 เดือนได้ 400, Clerk ได้ 403
- [ ] 4.3 `GET /reports/summary/export` — ตรวจด้วย e2e test: ไฟล์ขึ้นต้นด้วย BOM, มีทั้งส่วนรายเดือนและผู้ขาย, ภาษาไทยถูกต้อง, มี audit `report.exported`
- [ ] 4.4 วัดเวลาของ `/reports/summary` กับข้อมูลจำลอง 12 เดือน × 3,500 ฉบับ — ตรวจว่าตอบภายใน 1 วินาทีบนเครื่อง dev และบันทึกผลใน `qa/` ของรีโพหลัก

## 5. Web (`Web/`)

- [ ] 5.1 หน้า `/admin/api-keys` (design D7) — ตรวจด้วย Playwright (API จำลอง): สร้างแล้วเห็น key ครั้งเดียว, ปิดกล่องแล้วไม่เห็นอีก, ไม่เลือกขอบเขตบันทึกไม่ได้, เพิกถอนผ่านกล่องยืนยันแล้วสถานะเปลี่ยน
- [ ] 5.2 หน้า `/admin/logs` — ตรวจด้วย Playwright: ตัวกรองส่งไป API ถูกต้อง, ขยายดูรายละเอียดได้, แบ่งหน้า
- [ ] 5.3 หน้า `/vendors` และ `/vendors/[id]` — ตรวจด้วย Playwright: ค้นหา, ป้ายผู้ขายรายใหม่, รายการเอกสารลิงก์ไปหน้าเอกสาร, ไม่มีปุ่มแก้ไข
- [ ] 5.4 หน้า `/reports` — ตรวจด้วย Playwright: เปลี่ยนช่วงแล้วเรียก API ใหม่, ตารางรายเดือนและยอดรวมตรงกับข้อมูล, ส่งออก CSV ได้ไฟล์ที่มี BOM
- [ ] 5.5 เมนูใน `lib/roles.ts` (API keys, System logs ของ SYS_ADMIN) — ตรวจด้วย unit test ของเมนูตาม role
- [ ] 5.6 อัปเดต `Web/README.md` และ `Service/README.md` (การใช้ API key พร้อมตัวอย่าง `curl` อัปโหลด, System logs และการเก็บ 30 วัน, รายงาน) — ตรวจว่าตัวอย่าง `curl` ใช้ได้จริงกับ stack

## 6. Integration check

- [ ] 6.1 E2E ใน `qa/e2e` กับ stack จริง: Admin สร้าง key ขอบเขตอัปโหลด → อัปโหลดด้วย `curl`/API ด้วย key → เอกสารเข้าคิวและ Clerk เห็น → Exec เห็นผู้อัปโหลดเป็นชื่อ key ใน audit → Admin เพิกถอน → key ใช้ไม่ได้; Clerk เห็นผู้ขายในทะเบียน; Exec เปิดรายงานแล้วยอดตรงกับเอกสารที่ทำใน test; Admin เห็น error ที่จำลองใน System logs — ตรวจด้วย Playwright ผ่าน 3 รอบติดกัน
- [ ] 6.2 E2E ของ Phase 1–3 และ test ของเว็บทั้งหมดยังผ่าน — ตรวจด้วยการรัน `qa/e2e` และ `pnpm test:e2e` ของเว็บทั้งชุด

## Workflow follow-up

- เปิด PR (ต่อจาก PR #3 ของแต่ละรีโพ) และรอ CI เขียว
- รีวิวกับผู้ใช้แล้ว archive ด้วย `/opsx:archive` ก่อนเริ่มวางแผน Phase 4 (optimize + deploy บน hosting ฟรี)
