# Tasks

> แตก branch ของ Phase 3 ต่อจาก branch ของ Phase 2 (`feat/phase2-core-features` ใน Service/Web, `docs/phase2-planning` ใน repo หลัก) จนกว่า PR ของ Phase 2 จะ merge งานที่ต้องมี Odoo จริงใช้ compose profile `odoo` ในเครื่อง (ไม่มีค่าใช้จ่าย)

## 1. Odoo สำหรับ dev และ payload กลาง

- [ ] 1.1 compose profile `odoo` (`odoo:19` + `postgres:16` ของ Odoo) และสคริปต์ `docker/odoo/setup.sh` ตาม design D10 (ฐาน `sdes_erp`, `account` + `l10n_th`, ผู้ใช้ `sdes-integration`, ออก API key ผ่าน `odoo shell`, พิมพ์ id ของ journal/ภาษีซื้อ 7%/บัญชีค่าใช้จ่าย) — ตรวจด้วยการรันบนเครื่องแล้วเรียก `POST /json/2/res.users/search_read` ด้วย key ที่ได้สำเร็จ
- [ ] 1.2 `buildErpPayload` ใน `packages/core` และปรับ `ErpAdapter` ให้รับ `ErpPayload` + ไฟล์ และคืน `{ transactionId, reused }` (design D2) — ตรวจด้วย unit test: ยอดทุกชั้น, บรรทัด, ข้อมูลหัก ณ ที่จ่าย, idempotency key คงที่ต่อเอกสาร
- [ ] 1.3 ซิงก์ core ไปเว็บด้วย `pnpm sync:core` ถ้าโมดูลที่แชร์เปลี่ยน — ตรวจด้วย `pnpm sync:core --check` ผ่าน

## 2. Data model และการเข้ารหัส secret (`packages/db`)

- [ ] 2.1 Migration ตาม design D6 (`erp_connections`, `vendors.erp_partner_id`, `documents.erp_transaction_id/synced_at/sync_error`, `erp_sync_attempts.reused`) — ตรวจด้วย integration test ว่า migrate บนฐานที่มีข้อมูล Phase 2 สำเร็จ และ `erp_connections` มีได้แถวเดียว
- [ ] 2.2 `encryptSecret`/`decryptSecret` (AES-256-GCM, กุญแจ `ERP_SECRET_KEY`) + `ERP_SECRET_KEY` ใน `.env.example` และ compose (api, worker) — ตรวจด้วย unit test: เข้ารหัสแล้วถอดได้ค่าเดิม, iv ไม่ซ้ำ, แก้ ciphertext/tag แล้วถอดไม่ผ่าน, ไม่มีกุญแจแล้ว api/worker หยุดพร้อมข้อความเมื่อมีการตั้งค่าที่ต้องถอด
- [ ] 2.3 อัปเดต `Service/docs/data-model.md` — ตรวจว่าทุก column/ตารางใหม่มีคำอธิบาย

## 3. Adapter (`apps/worker`)

- [ ] 3.1 `OdooClient` แบบ `json2` และ `jsonrpc` (design D3 transport) พร้อมจำแนกข้อผิดพลาด — ตรวจด้วย unit test ที่ mock `fetch`: รูปแบบ URL/header/body ของทั้งสองแบบ, 5xx/429/หมดเวลา = ชั่วคราว, 401/403/422 = ถาวรพร้อมข้อความจาก Odoo
- [ ] 3.2 `OdooErpAdapter`: หา/สร้างคู่ค้า, กันซ้ำด้วย `invoice_origin`, สร้างใบแจ้งหนี้ร่าง (ส่วนลดบรรทัดเป็น %, ส่วนลดท้ายบิลเป็นบรรทัดติดลบ, ยกเว้น VAT ไม่ใส่ภาษี, หมายเหตุหัก ณ ที่จ่าย), ตรวจยอดหลังสร้าง, แนบไฟล์ — ตรวจด้วย integration test กับ Odoo ใน profile `odoo` ตามทุก scenario ของ requirement "Odoo vendor bill content", "Withholding tax information", "Vendor partner in ERP" และ "No duplicate records in ERP"
- [ ] 3.3 `WebhookErpAdapter` (design D4) — ตรวจด้วย unit test กับ HTTP server จำลอง: ลายเซ็นตรวจได้ด้วย secret เดียวกัน, idempotency key เท่ากันเมื่อส่งซ้ำ, 2xx/5xx/4xx จำแนกถูก
- [ ] 3.4 คิว `erp-sync` + reconciler ตาม design D1 (เปลี่ยน `VERIFIED/APPROVED→SYNCING` เมื่อเปิดส่งอัตโนมัติ, retry 3 ครั้ง, `SYNC_FAILED` + `sync_error`, เขียน `erp_sync_attempts`, publish สถานะ) — ตรวจด้วย integration test ด้วย adapter จำลอง: 503 แล้วสำเร็จ → `SYNCED` + 2 attempts, ล้มเหลว 3 ครั้ง → `SYNC_FAILED`, 4xx → ล้มเหลวทันที, การส่งอัตโนมัติปิด → ไม่ส่งและรอ, เปิดแล้ว reconciler ส่งงานค้าง

## 4. API (`apps/api`)

- [ ] 4.1 `GET/PUT /erp/connection`, `POST /erp/connection/test`, `PUT /erp/connection/auto-sync` (design D5, D7) — ตรวจด้วย e2e test ตาม scenario ใน spec `erp-connection` (secret ไม่ถูกส่งกลับ/ไม่อยู่ใน audit, เว้นว่างคงค่าเดิม, แก้การตั้งค่าแล้วปิดส่งอัตโนมัติ, เปิดก่อนทดสอบถูกปฏิเสธ, `FINANCE_EXEC` ได้ 403)
- [ ] 4.2 enqueue งานส่งหลังยืนยัน (`VERIFIED`) และอนุมัติ (`APPROVED`) และเมื่อเปิดการส่งอัตโนมัติ — ตรวจด้วย e2e test ว่างานเข้าคิวเฉพาะกรณีที่ spec กำหนด และ `PENDING_APPROVAL`/`REJECTED` ไม่เข้าคิว
- [ ] 4.3 `POST /documents/resend`, `GET /ops/overview`, `GET /ops/sync-failed` และ permission `ops.view` (SYS_ADMIN, FINANCE_EXEC) ใน core — ตรวจด้วย e2e test: ส่งใหม่หลายฉบับ, `AP_LEAD` ส่งใหม่ได้ 403, Exec อ่านภาพรวมได้, Clerk ได้ 403
- [ ] 4.4 ขยาย `GET /documents/:id` (เลขอ้างอิง ERP, เวลา, เหตุผลล่าสุด, ประวัติการส่ง) และรายการเอกสาร — ตรวจด้วย e2e test
- [ ] 4.5 audit: ตัวกรอง `docNo` และ `GET /audit-events/export` (CSV UTF-8 + BOM, stream, สูงสุด 50,000 แถว, audit การส่งออก) — ตรวจด้วย e2e test: ไฟล์ขึ้นต้นด้วย BOM, ภาษาไทยถูกต้อง, มี audit ของการส่งออก, Clerk ได้ 403

## 5. ความปลอดภัย (platform-security)

- [ ] 5.1 Rate limit ด้วย `@nestjs/throttler` + Redis storage (login/refresh ต่อ IP 10/นาที, upload ต่อผู้ใช้ 60/นาที) — ตรวจด้วย e2e test: คำขอที่ 11 ได้ 429 + `Retry-After` และไม่มี audit `auth.login_failed` ของคำขอนั้น
- [ ] 5.2 `helmet` ที่ api และ security headers + CSP ใน `next.config.ts` ของเว็บ — ตรวจด้วย e2e test ของ api และ Playwright ว่า header ครบ และหน้าตรวจ (PDF.js, socket.io) ยังทำงานภายใต้ CSP
- [ ] 5.3 CI ทั้งสอง repo: `pnpm audit --prod --audit-level critical` + `security/audit-exceptions.json` (เหตุผล + วันหมดอายุ) — ตรวจด้วย workflow เขียว และ test ของสคริปต์ตรวจรายการยกเว้นที่หมดอายุ
- [ ] 5.4 Authorization regression test (design D9) — ตรวจด้วย test ที่ผ่านกับโค้ดปัจจุบัน และไม่ผ่านเมื่อเพิ่ม route ทดลองที่ไม่มี `@RequirePermission`

## 6. Web (`Web/`)

- [ ] 6.1 หน้า `/admin/erp`: ฟอร์มตั้งค่า (secret แสดงเป็น "ตั้งแล้ว" + ช่องเปลี่ยน), ทดสอบแสดงผลรายข้อ, สวิตช์ส่งอัตโนมัติที่บอกเหตุผลเมื่อเปิดไม่ได้ — ตรวจด้วย Playwright (API จำลอง) ตาม scenario ใน spec `erp-connection`
- [ ] 6.2 หน้า `/admin/sync`: ภาพรวม (รีเฟรชทุก 30 วินาที), รายการ `SYNC_FAILED` + เลือกหลายรายการ + ส่งใหม่พร้อมกล่องยืนยัน, Exec อ่านอย่างเดียว — ตรวจด้วย Playwright ตาม spec `operations-monitoring`
- [ ] 6.3 หน้า `/audit`: ตัวกรอง (ช่วงเวลา, ผู้กระทำ, ประเภท, เลขเอกสาร), ตารางแบ่งหน้าพร้อมค่าก่อน/หลัง, ส่งออก CSV — ตรวจด้วย Playwright ตาม requirement "Audit trail viewer" และ "Audit export"
- [ ] 6.4 สถานะการส่งในคิวและหน้าตรวจ (เลขอ้างอิง ERP, เหตุผล `SYNC_FAILED` โดยไม่มีปุ่มส่งใหม่สำหรับ role ที่ไม่มีสิทธิ์) และเมนูใหม่ใน `lib/roles.ts` — ตรวจด้วย Playwright
- [ ] 6.5 อัปเดต `Web/README.md` และ `Service/README.md` (การตั้งค่า Odoo, profile `odoo`, `ERP_SECRET_KEY`, ตัวอย่างตรวจลายเซ็น webhook, rate limit) — ตรวจว่า env ใหม่ทุกตัวมีอธิบาย

## 7. Integration check

- [ ] 7.1 E2E ใน `qa/e2e` กับ stack จริง + Odoo (profile `odoo`) ตาม design D10: ยืนยัน/อนุมัติแล้วเห็นใบแจ้งหนี้ร่างใน Odoo ยอดตรงและมีไฟล์แนบ, ส่งใหม่ไม่เกิดใบซ้ำ, Odoo ปิด → `SYNC_FAILED` → เปิด Odoo → Admin ส่งใหม่ → `SYNCED`, Exec เห็น audit ของการส่ง — ตรวจด้วย Playwright ผ่าน 3 รอบติดกัน
- [ ] 7.2 E2E ของ Phase 1–2 ยังผ่านเมื่อเปิด rate limit และ security headers — ตรวจด้วยการรัน `qa/e2e` ทั้งหมด

## Workflow follow-up

- ขอรุ่น/edition ของ Odoo จริงจากผู้ใช้ แล้วทดสอบการเชื่อมต่อกับ Odoo ของบริษัท (ไม่ใช่ใน dev) ก่อนเปิดการส่งอัตโนมัติ
- รีวิวกับผู้ใช้แล้ว archive ด้วย `/opsx:archive`
