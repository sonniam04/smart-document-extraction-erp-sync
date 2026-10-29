# Design

## Context

ต่อจาก `phase2-core-features` (ยังไม่ archive — งานที่ต้องใช้ API key ของ AI ถูกเลื่อนไว้ท้ายโปรเจกต์):

- state machine มีเส้นทาง `VERIFIED→SYNCING` และ `APPROVED→SYNCING` (ระบบ), `SYNCING→SYNCED/SYNC_FAILED` (ระบบ), `SYNC_FAILED→SYNCING` (`SYS_ADMIN`) อยู่แล้ว เอกสาร `VERIFIED` ทุกฉบับไม่มีความเสี่ยง เพราะเคสเสี่ยงถูกย้ายไป `PENDING_APPROVAL` ตั้งแต่ตอนยืนยัน
- `packages/core` มี interface `ErpAdapter { push(SignedErpPayload), health() }` และ permission `erp.configure`, `apikey.manage`, `sync.resend` ของ `SYS_ADMIN`; ตาราง `erp_sync_attempts` มีโครงแล้ว
- worker ใช้ BullMQ แบบ jobId = document id + reconciler ทุก 1 นาที (รูปแบบเดียวกันใช้กับคิวส่ง ERP ได้)
- ผู้ใช้ยืนยันว่า ERP คือ **Odoo แบบ self-hosted รันเป็น docker service** ยังไม่ทราบรุ่น
- Odoo 19 มี JSON-2 API: `POST /json/2/<model>/<method>`, `Authorization: bearer <API key>`, header `X-Odoo-Database` (เมื่อมีหลายฐาน), body เป็น JSON ของ `ids` + argument แบบชื่อ, error เป็น 4xx/5xx พร้อม `{name, message, ...}`; XML-RPC/JSON-RPC จะถูกถอดใน Odoo 22

## Goals / Non-Goals

**Goals:**
- ส่งเข้า Odoo แบบ idempotent: ส่งกี่ครั้งก็ได้ใบแจ้งหนี้ใบเดียว
- adapter สลับได้ด้วยการตั้งค่า โดยตัวจัดคิว/retry/สถานะไม่ต้องรู้จัก Odoo
- ทดสอบตลอดสายกับ Odoo จริงในเครื่อง

**Non-Goals:**
- post ใบแจ้งหนี้, จ่ายเงิน, ออกหนังสือรับรองหัก ณ ที่จ่ายใน Odoo
- อ่านข้อมูลกลับจาก Odoo มาแก้ในระบบนี้ (ซิงก์ทางเดียว)
- ผูกรายการกับสินค้า (`product.product`) ใน Odoo

## Decisions

### D1. คิว `erp-sync` ใน worker
- งานหนึ่งต่อเอกสาร `jobId = documentId`, `attempts: 3`, exponential backoff เริ่ม 5 วินาที, `UnrecoverableError` สำหรับข้อผิดพลาดถาวร (รูปแบบเดียวกับคิวอ่านเอกสาร)
- **ใครใส่งานเข้าคิว:** api หลัง commit เมื่อยืนยันเอกสารที่ได้ `VERIFIED`, เมื่ออนุมัติ (`APPROVED`), เมื่อสั่งส่งใหม่ และเมื่อเปิดการส่งอัตโนมัติ; ส่วน **reconciler** ใน worker ทุก 1 นาทีเก็บตก `VERIFIED`/`APPROVED` ที่ค้าง (เช่น enqueue ไม่สำเร็จ หรือรออยู่ตอนที่การส่งอัตโนมัติปิด) และ `SYNCING` ที่ไม่มีงานในคิวเกิน 5 นาที
- **ใครเปลี่ยนสถานะ:** worker เปลี่ยน `VERIFIED/APPROVED→SYNCING` (ระบบ) ตอนเริ่มงานเมื่อการส่งอัตโนมัติเปิดอยู่ ถ้าปิดอยู่งานจบเงียบ ๆ (reconciler จะใส่ใหม่เมื่อเปิด); การส่งใหม่ api เปลี่ยน `SYNC_FAILED→SYNCING` ในนาม Admin แล้ว enqueue
- ทุกครั้งที่ลองส่งเขียน `erp_sync_attempts` หนึ่งแถว (ครั้งที่, adapter, เวลาส่ง/ตอบ, ผล, เลขอ้างอิง, ข้อความผิดพลาด) และ publish สถานะผ่าน Redis channel เดิม

### D2. Payload กลางใน `packages/core`
`buildErpPayload(document, vendor) → ErpPayload` เป็น pure function: เลขเอกสารระบบ, idempotency key `sdes:<documentId>`, ผู้ขาย (ชื่อ, Tax ID, สาขา), เลขที่/วันที่ใบแจ้งหนี้, บรรทัดรายการ, ยอดทุกชั้น และข้อมูลหัก ณ ที่จ่าย ใช้ค่าจาก `documents.data` ที่ผ่านกฎตรวจแล้ว (ตอนนั้นไม่มี ERROR) ทั้ง Odoo และ webhook ใช้ payload เดียวกันนี้ ปรับ `ErpAdapter.push` ให้รับ `ErpPayload` + ไฟล์ต้นฉบับ และคืน `{ transactionId, reused }` (`SignedErpPayload` เดิมย้ายไปอยู่ภายใน webhook adapter)

### D3. `OdooErpAdapter`
- **Transport:** `OdooClient` สองแบบตาม `apiMode` ในการตั้งค่า — `json2` (ค่าเริ่มต้น, Odoo 19+): `POST {url}/json/2/{model}/{method}` + bearer API key + `X-Odoo-Database`; `jsonrpc` (Odoo 17–18): `POST {url}/jsonrpc` ด้วย `execute_kw` (login + API key แทนรหัสผ่าน) ทั้งสองแบบเปิดเผยแค่ `searchRead`, `create`, `write`, `read` ให้ adapter ใช้ ใช้ `fetch` ของ Node ไม่ต้องมี dependency เพิ่ม
- **คู่ค้า:** ใช้ `vendors.erp_partner_id` ถ้ามี; ไม่มีก็ `res.partner.search_read([["vat","=",taxId]])` เลือกตัวที่ `ref` ตรงรหัสสาขาก่อน แล้วตัวแรก; ไม่พบก็ `create({name, vat, is_company: true, ref: branch})` แล้วบันทึก id กลับลง `vendors`
- **กันซ้ำ:** ก่อนสร้าง ค้น `account.move` ที่ `move_type = "in_invoice"` และ `invoice_origin = <เลขเอกสารระบบ>` ถ้าพบใช้ใบเดิม (`reused: true`) — `invoice_origin` เป็นช่องอ้างอิงต้นทางที่ Odoo มีอยู่แล้ว
- **สร้างใบแจ้งหนี้ร่าง:** `account.move.create` ด้วย `move_type: "in_invoice"`, `partner_id`, `invoice_date`, `ref` = เลขที่ใบแจ้งหนี้ของผู้ขาย, `invoice_origin` = เลขเอกสารระบบ, `journal_id`, `narration` (เลขเอกสาร + ข้อมูลหัก ณ ที่จ่าย), `invoice_line_ids` แต่ละบรรทัด `[0, 0, {name, quantity, price_unit, discount, account_id, tax_ids: [[6, 0, [taxId]]]}]` — ส่วนลดของบรรทัดแปลงเป็น % ของ `quantity × price_unit` (Odoo ใช้ %), ส่วนลดท้ายบิลเป็นบรรทัดติดลบ "ส่วนลด" ที่มีภาษีเดียวกัน, เอกสารยกเว้น VAT ไม่ใส่ `tax_ids`
- **ตรวจยอดหลังสร้าง:** อ่าน `amount_total` กลับมา ถ้าต่างจากยอดรวมเกิน 0.01 → เขียน `narration` นำหน้าด้วย "[SDES: ยอดไม่ตรง ต้องตรวจ]" แล้วเป็นข้อผิดพลาดถาวรที่บอกทั้งสองยอด (ส่งใหม่หลังแก้ใน Odoo จะเจอใบเดิมและตรวจยอดอีกครั้ง)
- **แนบไฟล์:** `ir.attachment.create({name, datas: base64, res_model: "account.move", res_id, mimetype})` เมื่อยังไม่มีไฟล์ชื่อเดียวกันในใบนั้น
- **จำแนกข้อผิดพลาด:** เชื่อมต่อไม่ได้/หมดเวลา/5xx/429 = ชั่วคราว; 401/403 (key ผิด/สิทธิ์ไม่พอ) และ 4xx/error ของ Odoo อื่น = ถาวร พร้อม `message` จาก Odoo
- **ทางเลือกที่ไม่เลือก:** XML-RPC (กำลังจะถูกถอด และ parse XML ยุ่งกว่า); สร้างใบแจ้งหนี้แบบ posted (ข้ามการตรวจของฝ่ายบัญชีใน Odoo)

### D4. `WebhookErpAdapter`
POST JSON ของ `ErpPayload` ไปที่ URL ที่ตั้งไว้ พร้อม `X-SDES-Timestamp`, `X-SDES-Signature: sha256=<hex(HMAC-SHA256(secret, timestamp + "." + body))>`, `Idempotency-Key`; 2xx ที่มี `{ "transactionId": "..." }` = สำเร็จ, 5xx/429/หมดเวลา = ชั่วคราว, 4xx อื่น = ถาวร ตัวอย่างโค้ดตรวจลายเซ็นของปลายทางอยู่ใน README

### D5. การตั้งค่าการเชื่อมต่อและ secret
- ตาราง `erp_connections` (แถวเดียว): `adapter`, `url`, `database`, `config` jsonb (`apiMode`, `login`, `journalId`, `purchaseTaxId`, `expenseAccountId`), `secret_ciphertext`/`secret_iv`/`secret_tag` (AES-256-GCM), `auto_sync`, `tested_at`, `tested_hash` (hash ของการตั้งค่าที่ทดสอบผ่าน), `updated_by`, `updated_at`
- กุญแจ `ERP_SECRET_KEY` (32 ไบต์ base64) อยู่ใน `.env` และส่งให้ทั้ง api (เข้ารหัส/ทดสอบ) และ worker (ถอดรหัส) เท่านั้น; ฟังก์ชัน `encryptSecret`/`decryptSecret` อยู่ใน `packages/db`
- เปิด `auto_sync` ได้เมื่อ `tested_hash` ตรงกับ hash ของการตั้งค่าปัจจุบัน — แก้ช่องใดก็ตาม (รวม secret) hash เปลี่ยนจึงปิด `auto_sync` อัตโนมัติ
- การทดสอบ (Odoo): อ่าน `res.users` ของตัวเอง (ยืนยันตัวตน) → อ่าน `account.journal`/`account.tax`/`account.account` ตาม id ที่ตั้ง; ทำเฉพาะการอ่าน (spec: ไม่สร้างข้อมูล)

### D6. Migration
- `erp_connections` ตาม D5
- `vendors.erp_partner_id text`
- `documents.erp_transaction_id text`, `synced_at timestamptz`, `sync_error text` (เหตุผลล่าสุด สำหรับแสดงผล)
- `erp_sync_attempts`: เพิ่ม `reused boolean`

### D7. API
| Endpoint | สิทธิ์ | หมายเหตุ |
|---|---|---|
| `GET/PUT /erp/connection` | `erp.configure` | อ่าน/บันทึก (secret เป็น `hasSecret: boolean`; ช่อง secret ว่าง = คงเดิม) |
| `POST /erp/connection/test` | `erp.configure` | ผลรายข้อ `{ reach, auth, journal, tax, account }` |
| `PUT /erp/connection/auto-sync` | `erp.configure` | เปิดได้เมื่อทดสอบผ่านกับการตั้งค่าปัจจุบัน; เปิดแล้ว enqueue งานค้าง |
| `GET /ops/overview` | `ops.view` (ใหม่: SYS_ADMIN, FINANCE_EXEC) | จำนวนต่อสถานะ, งานค้างในคิว, ส่งสำเร็จล่าสุด, สถานะการส่งอัตโนมัติ |
| `GET /ops/sync-failed` | `ops.view` | รายการ `SYNC_FAILED` + ครั้งที่ส่ง + เหตุผลล่าสุด |
| `POST /documents/resend` | `sync.resend` | `{ ids: [] }` สูงสุด 100 ต่อครั้ง ผลรายฉบับ |
| `GET /documents/:id` (ขยาย) | `document.view` | เพิ่ม `erpTransactionId`, `syncedAt`, `syncError`, `syncAttempts` |
| `GET /audit-events` (ขยาย) | `audit.view_all` | เพิ่มตัวกรอง `docNo` |
| `GET /audit-events/export` | `audit.view_all` | CSV UTF-8 + BOM ตามตัวกรองเดียวกัน สูงสุด 50,000 แถว (stream) + audit การส่งออก |

### D8. Web
- `/admin/erp` (ตั้งค่า + ทดสอบรายข้อ + สวิตช์ส่งอัตโนมัติ), `/admin/sync` (ภาพรวม + คิวที่ล้มเหลว + ส่งใหม่แบบเลือกหลายรายการ; Exec อ่านอย่างเดียว), `/audit` (ค้นหา + ส่งออก CSV)
- หน้าคิวและหน้าตรวจแสดงสถานะการส่ง เลขอ้างอิง ERP และเหตุผลล่าสุดของ `SYNC_FAILED`; เมนูใน `lib/roles.ts` เพิ่ม "ติดตามการส่ง" และ "เชื่อมต่อ ERP" ส่วน "Audit trail" มีอยู่แล้วแต่ยังไม่มีหน้า

### D9. ความปลอดภัย
- **Rate limit:** `@nestjs/throttler` ใช้ Redis เป็น storage (รองรับหลาย instance) — login/refresh ต่อ IP 10/นาที, upload ต่อผู้ใช้ 60/นาที; 429 พร้อม `Retry-After`
- **Headers:** `helmet` ที่ api; เว็บตั้ง `headers()` ใน `next.config.ts` (CSP ที่อนุญาต `self`, socket.io ของ API และ worker ของ PDF.js, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy`)
- **Dependency gate:** CI ทั้งสอง repo รัน `pnpm audit --prod --audit-level critical`; ยกเว้นได้ผ่านไฟล์ `security/audit-exceptions.json` ที่ต้องมีเหตุผลและวันหมดอายุ
- **Authorization regression test:** ใช้ `DiscoveryService` ของ Nest ไล่ทุก route ที่ไม่ใช่ `@Public()` แล้วยืนยันว่ามี `@RequirePermission`; test แบบตารางเรียกทุก route ด้วยผู้ใช้ 4 role แล้วเทียบกับ `PERMISSIONS` (คาด 403 หรือไม่ใช่ 403)

### D10. Odoo ใน dev และ E2E
- compose profile `odoo`: `odoo:19` + `postgres:16` แยก (`odoo-db`) เปิดเมื่อต้องการด้วย `--profile odoo` (RAM เพิ่มราว 1 GB) port `8069`
- สคริปต์ `docker/odoo/setup.sh`: สร้างฐาน `sdes_erp`, ติดตั้ง `account` และ `l10n_th`, สร้างผู้ใช้ `sdes-integration` สิทธิ์บัญชี และออก API key ผ่าน `odoo shell` (`res.users.apikeys._generate`) แล้วพิมพ์ id ของ journal ซื้อ/ภาษีซื้อ 7%/บัญชีค่าใช้จ่ายให้ใส่ในหน้าตั้งค่า — key แสดงครั้งเดียวและไม่เขียนลงไฟล์
- E2E ใน `qa/e2e` ตั้งค่าการเชื่อมต่อผ่าน API, ทดสอบ, เปิดการส่ง แล้วตรวจใบแจ้งหนี้ใน Odoo ผ่าน JSON-2 โดยตรง (มีจริง, ยอดตรง, มีไฟล์แนบ, ไม่ซ้ำเมื่อส่งใหม่) และกรณี Odoo ปิดอยู่ → `SYNC_FAILED` → เปิด → ส่งใหม่สำเร็จ

## Risks / Trade-offs

- [ไม่ทราบรุ่น Odoo ของบริษัท] → รองรับทั้ง JSON-2 (19+) และ JSON-RPC (17–18) ผ่าน `apiMode`; ทดสอบกับ `odoo:19` และ unit test ของ transport ทั้งสองแบบ; ขอรุ่นจริงจากผู้ใช้ก่อนทดสอบกับระบบจริง
- [การปัดเศษของ Odoo ต่างจากระบบ (ส่วนลด %, ภาษีรายบรรทัด vs รวม)] → ตรวจยอดหลังสร้าง (D3) และไม่ post อัตโนมัติ ให้ฝ่ายบัญชีเห็นก่อน; บันทึกกรณีที่เจอใน E2E
- [เอกสารที่ VAT เพียงบางรายการ (ฐานภาษี < ยอดก่อนภาษี)] → ไม่รู้ว่าบรรทัดไหนยกเว้น จึงอาจได้ยอดไม่ตรง → `SYNC_FAILED` พร้อมเหตุผลให้แก้ใน Odoo แล้วส่งใหม่; ปรับปรุงภายหลังถ้าพบบ่อย
- [สร้างคู่ค้าใหม่ใน Odoo อัตโนมัติอาจได้คู่ค้าซ้ำถ้าข้อมูลเดิมใน Odoo ไม่มี Tax ID] → ค้นด้วย Tax ID ก่อนเสมอ และแสดงรายการคู่ค้าที่ระบบสร้างในหน้าติดตามให้ฝ่ายบัญชีรวมภายหลังได้
- [กุญแจ `ERP_SECRET_KEY` หาย = ถอด API key ไม่ได้] → ต้องใส่ API key ใหม่ในหน้าตั้งค่าเท่านั้น (ไม่กระทบข้อมูลเอกสาร); ระบุใน README ให้เก็บกุญแจใน secret manager ของ production (Phase 4)
- [Odoo + ClamAV + stack เดิมใช้ RAM เกินเครื่อง dev] → Odoo อยู่ใน profile แยก เปิดเฉพาะตอนพัฒนา/ทดสอบส่วน ERP

## Migration Plan

- Migration แบบ additive; การส่งอัตโนมัติเริ่มที่ปิด จึง deploy ได้โดยไม่มีเอกสารถูกส่งจนกว่า Admin จะตั้งค่าและทดสอบผ่าน
- เอกสาร `VERIFIED`/`APPROVED` ที่มีอยู่ก่อน deploy จะถูกส่งเมื่อเปิดการส่งอัตโนมัติ (spec "When documents are sent") — แจ้งผู้ใช้ก่อนเปิดใน production
- Rollback: ปิดการส่งอัตโนมัติ (ไม่ต้อง revert โค้ด)

## Open Questions

- รุ่นและ edition ของ Odoo ที่บริษัทใช้ และใช้ `l10n_th` อยู่หรือไม่ — กำหนดแค่ค่า `apiMode` และ id ของภาษี/บัญชีในหน้าตั้งค่า ไม่เปลี่ยนแผน
- journal ซื้อ, รหัสภาษีซื้อ 7% และบัญชีค่าใช้จ่ายที่ฝ่ายบัญชีต้องการใช้ — ตั้งได้จากหน้าตั้งค่า
