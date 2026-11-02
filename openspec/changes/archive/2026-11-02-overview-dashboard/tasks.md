# Tasks

> แตก branch `feat/overview-dashboard` ต่อจาก `feat/complete-missing-features` ใน Service/Web และ `docs/overview-dashboard` ต่อจาก `docs/complete-missing-features` ในรีโพหลัก จนกว่า PR ก่อนหน้าจะ merge

## 1. สิทธิ์และโค้ดคำนวณที่ใช้ร่วมกัน (`packages/core`, `apps/api`)

- [x] 1.1 เพิ่ม permission `dashboard.view` ให้ทั้ง 4 role ใน `packages/core` แล้ว `pnpm sync:core` ไปเว็บ — ตรวจด้วย unit test ของ permission matrix ตาม spec `user-access` (ทุก role มี, ขอบเขตของ API key ไม่มี) และ `pnpm sync:core --check` ผ่าน
- [x] 1.2 ย้ายการคำนวณตัวชี้วัดกระบวนการและยอดเงินของ `/reports/summary` ไปเป็น `ReportMetrics` ที่รับช่วงเวลา (design D2) — ตรวจด้วย e2e test ของรายงานเดิมผ่านโดยไม่แก้ test
- [x] 1.3 ย้ายการอ่านคิว/การเชื่อมต่อ ERP ของ `/ops/overview` เป็นฟังก์ชันที่ใช้ร่วมกัน — ตรวจด้วย e2e test ของ operations เดิมผ่านโดยไม่แก้ test

## 2. `GET /dashboard` (`apps/api`)

- [x] 2.1 endpoint + การประกอบส่วนตามสิทธิ์ (design D1) — ตรวจด้วย e2e test ตาม spec "Sections follow existing permissions": Clerk ไม่มี `finance`/`health`, Admin มีเฉพาะ `health` (มี `errors24h`, `expiringKeys`), Exec มี `health` แต่ไม่มี `errors24h`/`expiringKeys`, Lead+Exec ได้ทุกส่วนยกเว้นของ Admin, API key ได้ 403
- [x] 2.2 `backlog` (design D3) — ตรวจด้วย e2e test ตาม spec "Work backlog": จำนวนแต่ละกลุ่มและ `oldestAt` ของฉบับเก่าสุด, `UPLOADED`+`PROCESSING` รวมเป็นกลุ่มกำลังอ่าน
- [x] 2.3 `throughput` 14 วัน (design D3) — ตรวจด้วย e2e test ตาม spec "Throughput": 14 แถวเสมอรวมวันที่เป็น 0, เอกสาร 00:30 น. เวลาไทยนับเป็นวันนั้น, ตรวจแล้ว/ส่งแล้วนับครั้งแรกที่เข้าสถานะเท่านั้น
- [x] 2.4 `indicators` และ `finance` (design D2) — ตรวจด้วย e2e test ตาม spec "BRD indicators" และ "Finance snapshot": ไม่มีเอกสารยืนยันได้ `null` ไม่ใช่ 0, ยอดเงินเดือนนี้เท่ากับ `/reports/summary` ของเดือนเดียวกัน, เดือนก่อนเป็น 0 ไม่เกิดข้อผิดพลาด
- [x] 2.5 `health` (design D4) — ตรวจด้วย e2e test ตาม spec "System health": นับ error เฉพาะ 24 ชั่วโมงและระดับ error, key ที่ถูกเพิกถอนหรือหมดอายุแล้วไม่อยู่ในรายการใกล้หมดอายุ
- [x] 2.6 วัดเวลา `GET /dashboard` ด้วยผู้ใช้ที่ได้ทุกส่วนบนฐาน `sdes_perf` (12 เดือน × 3,500 ฉบับ) — ตรวจว่าตอบภายใน 1 วินาที (เพิ่ม index ตาม design D3 ถ้าจำเป็น) และบันทึกผลใน `qa/` ของรีโพหลัก
- [x] 2.7 อัปเดต Swagger/README ของ Service — ตรวจว่า `/dashboard` อยู่ใน Swagger พร้อมตัวอย่างผลลัพธ์

## 3. Web (`Web/`)

- [x] 3.1 `homeFor()` คืน `/` ทุก role และเมนู "ภาพรวม" เป็นรายการแรก (design D5) — ตรวจด้วย unit test ของเมนู/หน้าแรกตาม role และ Playwright: ล็อกอินปกติไปหน้าภาพรวม, ล็อกอินจากลิงก์เอกสารไปเอกสารนั้น
- [x] 3.2 คิวเอกสารอ่าน/เขียน `?tab=` และ `/admin/logs` อ่านตัวกรองจาก URL — ตรวจด้วย Playwright: `/documents?tab=failed` เปิดแท็บล้มเหลว, ค่าที่ไม่รู้จักใช้แท็บแรก, `/admin/logs?level=error` ส่งตัวกรองไป API
- [x] 3.3 หน้าภาพรวม: การ์ดงานค้าง, แนวโน้ม 14 วัน (SVG + ตารางสำหรับ screen reader), ตัวชี้วัดพร้อมเป้าและป้ายผ่าน/ไม่ผ่าน, การเงิน, สุขภาพระบบ — แสดงเฉพาะส่วนที่ API ส่งมา — ตรวจด้วย Playwright (API จำลอง) ต่อ role และลิงก์ของแต่ละการ์ดไปถูกที่ตาม design D5
- [x] 3.4 รีเฟรชทุก 30 วินาที หยุดเมื่อแท็บถูกซ่อน และคงข้อมูลเดิมเมื่อดึงไม่สำเร็จ — ตรวจด้วย Playwright (นาฬิกาจำลอง): ตัวเลขเปลี่ยนหลัง 30 วินาที, คำขอล้มเหลวแล้วยังเห็นตัวเลขเดิมพร้อมข้อความว่าข้อมูลอาจไม่เป็นปัจจุบัน
- [x] 3.5 ตรวจหน้าภาพรวมที่ 1366×768 และ < 1280px ด้วยแนวทางใน `Web/DESIGN.md` (สีแดงเฉพาะสถานะไม่ผ่าน/ล้มเหลว, ตัวเลขชิดขวา, ฟอนต์ Sarabun) และ axe ไม่พบปัญหาระดับ serious — ตรวจด้วย screenshot และผล axe ใน Playwright
- [x] 3.6 อัปเดต `Web/README.md` — ตรวจว่ามีหน้าภาพรวมและส่วนที่แต่ละ role เห็น

## 4. Integration check

- [x] 4.1 E2E ใน `qa/e2e` กับ stack จริง: Clerk อัปโหลดเอกสาร → หน้าภาพรวมของ Clerk แสดงรอตรวจเพิ่มขึ้นภายใน 30 วินาทีโดยไม่รีเฟรช → กดไปคิวแท็บรอตรวจ → ยืนยัน → ตัวเลขตรวจแล้ววันนี้เพิ่ม; Exec เห็นยอดเดือนนี้ตรงกับหน้ารายงาน; Admin เห็นสุขภาพระบบและ error ที่จำลอง — ตรวจด้วย Playwright ผ่าน 3 รอบติดกัน
- [x] 4.2 E2E ของงานก่อนหน้าและ test ของเว็บทั้งหมดยังผ่าน (รวม test ที่ล็อกอินแล้วคาดว่าไปหน้าคิวเอกสาร — ปรับให้ตรงกับหน้าแรกใหม่) — ตรวจด้วยการรัน `qa/e2e` และ `pnpm test:e2e` ของเว็บทั้งชุด

## Workflow follow-up

- เปิด draft PR (ต่อจาก PR #4 ของแต่ละรีโพ) และรอ CI เขียว
- รีวิวกับผู้ใช้แล้ว archive ด้วย `/opsx:archive` ก่อนเริ่มวางแผน Phase 4 (optimize + deploy บน hosting ฟรี)
