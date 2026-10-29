# QA E2E

Playwright suite ที่รันกับ stack จริง (ไม่มี mock)

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
3. เปิดเว็บ: `pnpm dev --port 3100` ใน `Web/`

## รัน

```bash
pnpm install --ignore-workspace
pnpm test                       # หรือ npx playwright test --repeat-each 5 เพื่อหา race
```

- `global-setup.ts` สร้างหรือรีเซ็ต `qa-admin@sdes.local` (SYS_ADMIN) ด้วยรหัสสุ่มใหม่ทุกรอบ ผ่านบัญชี owner ของฐานข้อมูลใน `Service/.env` — ไม่แตะ Admin ที่ seed ไว้ และไม่เขียนรหัสลงไฟล์
- ผู้ใช้และไฟล์ทุกตัวมีรหัสรอบ (`qa-clerk-<run>@sdes.local`, `qa-<run>-a.pdf`) จึงรันซ้ำบนฐานเดิมได้
- ตัวแปร: `SDES_WEB_URL` (ค่าเริ่มต้น `http://127.0.0.1:3100`), `SDES_API_URL` (`http://127.0.0.1:3000`), `SDES_SERVICE_DIR` (`../../Service`), `PW_CHANNEL` (`msedge`)
- ภาพหน้าคิวหลังอ่านเสร็จถูกบันทึกที่ `qa/phase1/evidence/e2e-documents-extracted.png`
