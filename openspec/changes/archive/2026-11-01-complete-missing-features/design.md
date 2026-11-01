# Design

## Context

ดูเหตุผลใน proposal.md ข้อจำกัดจากโค้ดปัจจุบันที่กำหนดแนวทาง:
- `AuthGuard` (api) รับเฉพาะ JWT ของผู้ใช้ แล้วสร้าง `Principal { userId, roles }` ให้ `PermissionGuard` ตรวจกับ permission matrix ใน `packages/core`
- `documents.uploaded_by` เป็น FK ไป `users` แบบบังคับ และ `audit_events.actor_user_id` ใช้ระบุผู้กระทำ ทุกอย่างที่ทำด้วย key จึงต้องมีบัญชีใน `users` ให้อ้างถึง
- `users.password_hash` เป็นค่าว่างได้อยู่แล้ว
- log ทุกจุดใช้ `Logger` ของ Nest และพิมพ์ลง stdout อย่างเดียว ส่วน `redact()` ใน `packages/core` ใช้ปิดบัง secret ใน audit อยู่แล้ว
- worker มีรูปแบบ reconciler แบบตั้งเวลาอยู่แล้ว (`reconcileIntervalMs`)
- `vendors` มีชื่อ, Tax ID, สาขา และ `erp_partner_id` ส่วนยอดเงินอยู่ใน column typed ของ `documents` และเวลาแต่ละขั้นอยู่ใน `document_status_history`
- เว็บมีเมนู `/vendors` และ `/reports` ใน `lib/roles.ts` แล้วแต่ยังไม่มีหน้า

## Goals / Non-Goals

**Goals:**
- API key ใช้ guard และ permission matrix เดิม ไม่สร้างเส้นทางตรวจสิทธิ์ใหม่ที่ต้องดูแลแยก
- การเก็บ log ไม่ทำให้ระบบช้าลงหรือล้มเมื่อฐานข้อมูลมีปัญหา
- รายงานคำนวณจากฐานข้อมูลตรง ๆ (ไม่มีตารางสรุปที่ต้องคอย sync) ที่ปริมาณ 3,500 ฉบับต่อเดือนตาม BRD

**Non-Goals:**
- OAuth client credentials, การหมุน key อัตโนมัติ, IP allowlist ต่อ key
- ระบบ log กลางภายนอก (เช่น Loki/ELK) และ log ระดับ info/debug ในฐานข้อมูล
- แก้ไข/รวม/ปิดใช้งานผู้ขาย และกราฟแบบโต้ตอบ

## Decisions

### D1. API key ผูกกับบัญชีบริการ (service account) ใน `users`
- ตอนสร้าง key ระบบสร้างแถวใน `users` ชนิด `SERVICE` (`kind` enum ใหม่ `HUMAN` | `SERVICE`, ค่าเริ่มต้น `HUMAN`) ชื่อเท่ากับชื่อ key, `password_hash = null`, `must_change_password = false` และ role ตามขอบเขต
- ขอบเขต `document.upload` → สิทธิ์ `document.upload` + `document.view`; `document.read` → `document.view` เท่านั้น guard สร้าง `Principal` ที่มีชุด permission ของ key (แทน role) แล้ว `PermissionGuard` ตรวจเหมือนเดิม จึงห้ามแก้/อนุมัติ/งาน admin ได้โดยอัตโนมัติ
- เหตุผล: FK ของ `uploaded_by` และ audit ทำงานได้ทันที และเพิกถอน key = ปิดบัญชีบริการ ทางเลือกที่ไม่เลือก: ทำ `actor_type = API_KEY` แยก จะต้องแก้ FK และทุกจุดที่แสดงผู้กระทำ
- ล็อกอินด้วยรหัสผ่านถูกปฏิเสธเพราะไม่มี `password_hash` (ข้อความเดียวกับรหัสผิด) และ `GET /admin/users` กรองเฉพาะ `kind = HUMAN`

### D2. รูปแบบและการเก็บ key
- key = `sdes_` + prefix 8 ตัว + `_` + ค่าสุ่ม 32 ไบต์ (base64url) — ส่งทาง header `Authorization: Bearer sdes_...` (หรือ `X-API-Key`) guard แยก key ออกจาก JWT ด้วยคำนำหน้า `sdes_`
- ตาราง `api_keys`: `id`, `service_user_id`, `name`, `prefix` (unique), `key_hash` (SHA-256 ของ key เต็ม), `scopes text[]`, `expires_at`, `last_used_at`, `revoked_at`, `revoked_by`, `created_by`, `created_at`
- ใช้ SHA-256 แทน argon2 เพราะ key สุ่ม 256 bit ไม่ต้องกันการเดาแบบ dictionary และต้องตรวจทุกคำขอ; หาแถวด้วย prefix แล้วเทียบ hash แบบ timing-safe
- `last_used_at` อัปเดตไม่เกินนาทีละครั้งต่อ key (กันเขียนทุกคำขอ)
- rate limit ต่อผู้ใช้เดิมใช้กับบัญชีบริการด้วย (tracker คือ `user:<serviceUserId>`)

### D3. API key endpoints
| Endpoint | สิทธิ์ | หมายเหตุ |
|---|---|---|
| `GET /admin/api-keys` | `apikey.manage` | รายการ: ชื่อ, prefix, ขอบเขต, หมดอายุ, ใช้ล่าสุด, สถานะ, ผู้สร้าง/ผู้เพิกถอน |
| `POST /admin/api-keys` | `apikey.manage` | `{ name, scopes, expiresInDays }` → คืนค่า key เต็มครั้งเดียว + audit `apikey.created` |
| `POST /admin/api-keys/:id/revoke` | `apikey.manage` | ตั้ง `revoked_at` + ปิดบัญชีบริการ + audit `apikey.revoked` |

### D4. System logs: logger ที่เขียนลงฐานแบบไม่บล็อก
- `DbLogger` ขยาย `ConsoleLogger` ของ Nest ใช้ทั้งใน api และ worker (อยู่ใน `packages/db`): พิมพ์ stdout เหมือนเดิม และสำหรับ `warn`/`error` ใส่คิวในหน่วยความจำ (สูงสุด 1,000 รายการ เกินแล้วทิ้งรายการเก่า) แล้ว flush เป็นชุดทุก 2 วินาทีด้วย `createMany`
- ข้อมูลผ่าน `redact()` ก่อนเก็บ และเพิ่มรูปแบบ connection string, `Bearer ...`, `sdes_...` และเลข 13 หลักที่ไม่อยู่ใน field Tax ID ให้ถูกปิดบัง; ข้อความยาวเกิน 4,000 ตัวตัดทิ้ง
- flush ล้มเหลว = พิมพ์คำเตือนลง stdout ครั้งเดียวต่อนาทีและทิ้งชุดนั้น (ไม่ log ความล้มเหลวลงฐานเพื่อกันวนซ้ำ)
- ตาราง `system_logs`: `id bigserial`, `created_at`, `service` (`api`|`worker`), `level` (`warn`|`error`), `context`, `message`, `details jsonb`, index `(created_at desc)` และ `(level, service, created_at)`; ค้นข้อความด้วย `ILIKE` (ปริมาณหลักพันแถวต่อวัน)
- worker ลบแถวที่เก่ากว่า 30 วันวันละครั้ง (ตั้งเวลาแบบเดียวกับ reconciler, รันครั้งแรกตอนเริ่ม)
- สิทธิ์ใหม่ `logs.view` (SYS_ADMIN) และ `GET /admin/system-logs?from&to&level&service&q&before&limit` แบบ cursor เหมือน audit

### D5. ทะเบียนผู้ขาย
- สิทธิ์ใหม่ `vendor.view` (AP_CLERK, AP_LEAD)
- `GET /vendors?q&page&pageSize` — aggregate ด้วย SQL เดียว: จำนวนเอกสาร, ยอดรวม `grand_total` ของสถานะ `VERIFIED`/`PENDING_APPROVAL`/`APPROVED`/`SYNCING`/`SYNCED`/`SYNC_FAILED`, `max(invoice_date)`, และ `isNew` = ไม่มีเอกสารใน `CONFIRMED_STATUSES` ยกเว้น `PENDING_APPROVAL` (นิยามเดียวกับที่ `review.service` ใช้ตั้งเหตุผล `NEW_VENDOR` — ย้ายเงื่อนไขนี้เป็นฟังก์ชันกลางเพื่อไม่ให้ป้ายกับเหตุผลความเสี่ยงขัดกัน); `q` ที่เป็นตัวเลขค้น Tax ID แบบขึ้นต้น ไม่ใช่ตัวเลขค้นชื่อแบบ `ILIKE`
- `GET /vendors/:id` — ข้อมูลเดียวกัน + เอกสาร 100 ฉบับล่าสุด

### D6. รายงาน
- `GET /reports/summary?from=YYYY-MM&to=YYYY-MM` (`report.view`): ช่วงไม่เกิน 24 เดือน ค่าเริ่มต้นเดือนปัจจุบัน
  - **การเงิน:** `date_trunc('month', invoice_date)` ของเอกสารสถานะยืนยันแล้วขึ้นไปที่ไม่ใช่ `REJECTED` (ชุดเดียวกับ D5) รวม `subtotal - discount` (ยอดก่อนภาษี), `vat_amount`, `wht_amount`, `grand_total` ด้วย `numeric` ใน SQL แล้วส่งเป็นสตริง 2 ตำแหน่ง (ไม่ผ่าน float)
  - **ผู้ขายยอดสูงสุด:** 10 อันดับตาม `grand_total`
  - **กระบวนการ:** เอกสารที่ `created_at` อยู่ในช่วง (เวลาไทย): จำนวนตามสถานะ, เวลาเฉลี่ยระหว่างแถวแรกของ `document_status_history` ที่เข้า `EXTRACTED`, `VERIFIED` และ `SYNCED`, สัดส่วนที่เคยเข้า `PENDING_APPROVAL`, สัดส่วนที่ยืนยันโดยไม่มี audit `document.field_edited`
- `GET /reports/summary/export` — CSV UTF-8 + BOM สองส่วน (รายเดือน, ผู้ขาย) + audit `report.exported`
- ทางเลือกที่ไม่เลือก: materialized view — ปริมาณ 3,500 ฉบับต่อเดือนคำนวณสดได้ใน < 1 วินาที และไม่ต้องจัดการการ refresh; Phase 4 วัดอีกครั้ง

### D7. Web
- `/admin/api-keys`: ตาราง + ฟอร์มสร้าง (ชื่อ, ช่องเลือกขอบเขต, อายุ) → กล่องแสดง key ครั้งเดียวพร้อมปุ่มคัดลอกที่ปิดได้หลังยืนยันว่าเก็บแล้ว; เพิกถอนผ่าน `ConfirmDialog`
- `/admin/logs`: ตัวกรองแบบหน้า `/audit` + แถวที่กดขยายดู `details`
- `/vendors` และ `/vendors/[id]`: ตาราง + ช่องค้นหา (debounce) + ป้าย "ผู้ขายรายใหม่"; เลขเอกสารลิงก์ไป `/documents/[id]`
- `/reports`: เลือกเดือนเริ่ม/สิ้นสุด, การ์ดยอดรวม, ตารางรายเดือน (ตัวเลขชิดขวา) พร้อมแท่งแนวนอนแบบ CSS ของยอดรวม, ตารางผู้ขาย, กลุ่มตัวชี้วัดกระบวนการ, ปุ่มส่งออก CSV — ไม่เพิ่ม library กราฟ
- เมนูใน `lib/roles.ts`: เพิ่ม "API keys" และ "System logs" ของ SYS_ADMIN; `/vendors` และ `/reports` ใช้ของเดิม

## Risks / Trade-offs

- [บัญชีบริการปนกับผู้ใช้จริงในจุดที่ query `users` ตรง ๆ] → กรอง `kind = HUMAN` ในรายการผู้ใช้และตัวกรองผู้กระทำ (`/audit-events/facets` แสดงทั้งสองแบบแต่แยกป้าย); authorization regression test ครอบคลุม endpoint ใหม่โดยอัตโนมัติ และเพิ่ม test ว่า key ทำนอกขอบเขตไม่ได้
- [key รั่วระหว่างใช้งาน] → อายุสูงสุด 365 วัน, เพิกถอนทันที, เห็น `last_used_at` และ audit ในชื่อ key
- [log จำนวนมากเมื่อเกิด error วนซ้ำ] → คิวจำกัด 1,000 รายการต่อ process และเก็บ 30 วัน; ถ้าเจอปัญหาใน Phase 4 ค่อยเพิ่มการรวม log ที่ซ้ำกัน
- [การปิดบังเลข 13 หลักลบ Tax ID ที่มีประโยชน์ใน log] → ยอมรับ เพราะ log ระดับ warning/error ใช้ docNo อ้างอิงได้แทน
- [ยอดในรายงานต่างจากยอดใน ERP เพราะ Odoo ปัดเศษภาษีต่างกัน] → รายงานระบุว่าเป็นยอดตามเอกสารใน SDES; การกระทบยอดกับ ERP อยู่นอกขอบเขต

## Migration Plan

- Migration แบบ additive: `users.kind` (ค่าเริ่มต้น `HUMAN` ใส่ให้ทุกแถวเดิม), ตาราง `api_keys`, `system_logs`; สิทธิ์ `sdes_app` ของ `system_logs` เป็น insert/select/delete (ไม่ update)
- deploy ได้โดยไม่กระทบผู้ใช้เดิม; rollback = ไม่ใช้หน้าใหม่ (ตารางใหม่ไม่ถูกอ้างโดยของเดิม)
