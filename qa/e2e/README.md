# QA E2E — Phase 1

Playwright suite ที่รันกับ stack จริง (ไม่มี mock) ตามงาน 8.1 ของ `phase1-architecture-foundations`:
Admin สร้าง Clerk และ Exec → Clerk ล็อกอินด้วยรหัสชั่วคราวและเปลี่ยนรหัส → อัปโหลด 3 ไฟล์ (ซ้ำ 1) → เห็นสถานะเป็น "รอตรวจ" โดยไม่รีเฟรช → Exec ล็อกอินและเห็น audit ของทุกขั้น

## ก่อนรัน

1. เปิด backend ตาม `Service/README.md` (`docker compose up -d --build --wait` + migrate + seed)
2. เปิดเว็บ: `pnpm dev --port 3100` ใน `Web/`

## รัน

```bash
pnpm install --ignore-workspace
pnpm test                       # หรือ npx playwright test --repeat-each 5 เพื่อหา race
```

- `global-setup.ts` สร้างหรือรีเซ็ต `qa-admin@sdes.local` (SYS_ADMIN) ด้วยรหัสสุ่มใหม่ทุกรอบ ผ่านบัญชี owner ของฐานข้อมูลใน `Service/.env` — ไม่แตะ Admin ที่ seed ไว้ และไม่เขียนรหัสลงไฟล์
- ผู้ใช้และไฟล์ทุกตัวมีรหัสรอบ (`qa-clerk-<run>@sdes.local`, `qa-<run>-a.pdf`) จึงรันซ้ำบนฐานเดิมได้
- ตัวแปร: `SDES_WEB_URL` (ค่าเริ่มต้น `http://127.0.0.1:3100`), `SDES_API_URL` (`http://127.0.0.1:3000`), `SDES_SERVICE_DIR` (`../../Service`), `PW_CHANNEL` (`msedge`)
- ภาพหน้าคิวหลังอ่านเสร็จถูกบันทึกที่ `qa/phase1/evidence/e2e-documents-extracted.png`
