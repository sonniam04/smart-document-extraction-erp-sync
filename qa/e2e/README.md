# QA E2E

Playwright suite ที่รันกับ stack จริง (ไม่มี mock)

**หน้าภาพรวม** (`tests/dashboard.spec.ts`, task 4.1 ของ `overview-dashboard`): Clerk ล็อกอินแล้วมาที่หน้าภาพรวม → อัปโหลดเอกสาร → จำนวนรอตรวจในหน้าที่เปิดค้างไว้เพิ่มขึ้นเองภายใน 30 วินาทีหลังอ่านเสร็จ (ไม่รีเฟรช) → กดไปคิวแท็บรอตรวจ → ยืนยัน → "ตรวจแล้ววันนี้" เพิ่ม 1 → Exec เห็นยอดรวมเดือนนี้เท่ากับหน้ารายงาน → Admin เห็นเฉพาะสุขภาพระบบ อัปโหลดไฟล์ที่ไม่มีเฉลย (worker เขียน log ระดับ error) แล้วจำนวน error 24 ชั่วโมงเพิ่ม และลิงก์ไป `/admin/logs?level=error` (ภาพหลักฐานใน `qa/overview-dashboard/evidence/`) — api ต้อง build ใหม่หลังเพิ่ม endpoint (`docker compose up -d --build --wait api`)

**ฟีเจอร์ที่ขาด** (`tests/missing-features.spec.ts`, task 6.1 ของ `complete-missing-features`): Admin สร้าง API key ที่หน้า `/admin/api-keys` → อัปโหลดตรงไปที่ API ด้วย `Authorization: Bearer <key>` → Clerk เห็นเอกสารในคิว → Exec เห็นผู้อัปโหลดเป็นชื่อ key ใน audit → Admin เพิกถอนแล้ว key ได้ 401 → Clerk ยืนยันแล้วเห็นผู้ขายรายใหม่ในทะเบียนผู้ขาย → รายงานเดือนของใบกำกับ (มี.ค. 2015) ยอดเพิ่มเท่าเอกสารฉบับนี้ → ส่งข้อความสถานะผิดรูปแบบเข้า Redis แล้ว Admin เห็น warning ใน `/admin/logs` (ภาพหลักฐานใน `qa/complete-missing-features/evidence/`)

**Phase 3** (`tests/phase3-erp.spec.ts`, task 7.1 ของ `phase3-erp-integration`): Admin ตั้งค่า Odoo ที่หน้า `/admin/erp` ทดสอบผ่านทุกข้อแล้วเปิดส่งอัตโนมัติ → A (ผู้ขายใหม่) ยืนยัน + AP Lead อนุมัติ → `SYNCED` และหน้าที่ Exec เปิดค้างไว้เห็นเลขอ้างอิง ERP แบบ real-time → ตรวจใบแจ้งหนี้ร่างใน Odoo ผ่าน JSON-2 (ใบเดียว, ยอด 10,700, คู่ค้าตาม Tax ID, มีไฟล์แนบ) → B (ผู้ขายเดิม) ยืนยันแล้วส่งทันที → จำลองคำตอบที่หาย (Odoo มีใบแล้วแต่ระบบเป็น `SYNC_FAILED`) แล้ว Admin ส่งใหม่ → ใช้ใบเดิม → ปิด Odoo → C เป็น `SYNC_FAILED` หลังลอง 3 ครั้ง, Clerk เห็นเหตุผลโดยไม่มีปุ่มส่งใหม่ → เปิด Odoo → Admin ส่งใหม่จาก `/admin/sync` → `SYNCED` → Exec เห็น audit ของการส่งและการตั้งค่า (ไม่มี API key ใน audit) จบแล้วปิดการส่งอัตโนมัติเสมอ เพื่อไม่ให้กระทบ E2E ของ Phase 1–2

**Phase 2** (`tests/phase2-flow.spec.ts`, task 8.1 ของ `phase2-core-features`): อัปโหลด 3 ฉบับ → `EXTRACTED` พร้อมจำนวนจุดที่ต้องแก้ → Clerk ยืนยันผู้ขายใหม่ → AP Lead อนุมัติ → เคสผู้ขายเดิมคงที่ `VERIFIED` → AP Lead แก้ยอดรวมตามรายการ "ต้องตรวจ" แล้วอนุมัติเองไม่ได้ → AP Lead อีกคนอนุมัติ → Exec เห็น audit การแก้ field และการอนุมัติ ไฟล์ที่อัปโหลดมีเฉลยที่ test เขียนลงโฟลเดอร์ fixture ก่อนอัปโหลด (`fixtures.ts`)

**Phase 1** (`tests/phase1-flow.spec.ts`):
Admin สร้าง Clerk และ Exec → Clerk ล็อกอินด้วยรหัสชั่วคราวและเปลี่ยนรหัส → อัปโหลด 3 ไฟล์ (ซ้ำ 1) → เห็นสถานะเป็น "รอตรวจ" โดยไม่รีเฟรช → Exec ล็อกอินและเห็น audit ของทุกขั้น

## ก่อนรัน

1. สร้างชุดเอกสารทดสอบ: `pnpm install --ignore-workspace && pnpm generate` ใน `qa/extraction-eval`
2. เปิด backend ตาม `Service/README.md` (migrate + seed) โดยให้ worker ใช้ fixture provider ที่ชี้มาที่เฉลยของชุดทดสอบ:
   ```bash
   EXTRACTION_PROVIDER=fixture EXTRACTION_FIXTURE_HOST_DIR=../qa/extraction-eval/out/fixtures docker compose up -d --build --wait
   # Windows: นำหน้าด้วย WSLENV=EXTRACTION_PROVIDER:EXTRACTION_FIXTURE_HOST_DIR แล้วสั่ง wsl docker compose ...
   ```
   - เพิ่ม `RATE_LIMIT_AUTH=300` (ใส่ใน `WSLENV` ด้วยบน Windows) — ทุกบัญชีทดสอบล็อกอินจากเครื่องเดียวจึงใช้โควตา login/refresh ของ IP เดียวกัน ค่าเริ่มต้น 10 ครั้ง/นาทีจะได้ 429
   - สำหรับ Phase 3 เพิ่ม `--profile odoo` แล้วรัน `sh docker/odoo/setup.sh > <ไฟล์นอก repo>` ใน `Service/` (ผลมี API key ของ Odoo — **ห้ามเก็บใน repo**)
3. เปิดเว็บ: `pnpm dev --port 3100` ใน `Web/`
4. Phase 3: ตั้ง `SDES_ODOO_SETUP=<ไฟล์จากข้อ 2>` ก่อนรัน (ไม่ตั้ง = ข้าม spec นี้) test จะสั่ง `docker compose --profile odoo stop/up odoo` เอง (`SDES_DOCKER`, ค่าเริ่มต้น `wsl docker` บน Windows) และใช้บัญชี owner จาก `Service/.env` จำลองคำตอบที่หาย

## รัน

```bash
pnpm install --ignore-workspace
pnpm test                       # หรือ npx playwright test --repeat-each 5 เพื่อหา race
```

- `global-setup.ts` สร้างหรือรีเซ็ต `qa-admin@sdes.local` (SYS_ADMIN) ด้วยรหัสสุ่มใหม่ทุกรอบ ผ่านบัญชี owner ของฐานข้อมูลใน `Service/.env` — ไม่แตะ Admin ที่ seed ไว้ และไม่เขียนรหัสลงไฟล์
- ผู้ใช้และไฟล์ทุกตัวมีรหัสรอบ (`qa-clerk-<run>@sdes.local`, `qa-<run>-a.pdf`) จึงรันซ้ำบนฐานเดิมได้
- ตัวแปรเพิ่มของ Phase 3: `SDES_ODOO_SETUP`, `SDES_ODOO_URL` (`http://127.0.0.1:8069`), `SDES_DOCKER`; ภาพหลักฐานบันทึกที่ `qa/phase3/evidence/`
- ตัวแปร: `SDES_WEB_URL` (ค่าเริ่มต้น `http://127.0.0.1:3100`), `SDES_API_URL` (`http://127.0.0.1:3000`), `SDES_SERVICE_DIR` (`../../Service`), `PW_CHANNEL` (`msedge`)
- ภาพหน้าคิวหลังอ่านเสร็จถูกบันทึกที่ `qa/phase1/evidence/e2e-documents-extracted.png`
