# Tasks

> งานทั้งหมดอยู่ใน `Web/` (repo `sdes-web`) ใช้ skill Impeccable ตาม design D1 กลุ่ม 3 ต้องเสร็จก่อน change `phase1-architecture-foundations` กลุ่ม 7

## 1. Product context และ wireframe

- [x] 1.1 รัน Impeccable `init` สร้าง `Web/PRODUCT.md` (ผู้ใช้ 4 role, งานหลัก, บริบทการใช้งานต่อเนื่องทั้งวัน, mode Operate) — ตรวจว่าไฟล์ระบุผู้ใช้ทั้ง 4 role และงานหลักของแต่ละ role
- [x] 1.2 รัน Impeccable `shape` สำหรับหน้าอัปโหลด/คิว และหน้า split-view — ตรวจว่าได้รายการ state, ข้อมูลที่ต้องแสดง และ flow ของแต่ละหน้าที่สอดคล้องกับ flow diagram
- [x] 1.3 ทำ wireframe 2 หน้าเป็น HTML ด้วยข้อมูลจำลอง (split-view: PDF + bbox / header form / line items / สรุปยอดชั้น 1–2 / ป้าย risk) แล้วส่งให้ผู้ใช้รีวิว — ตรวจด้วยการได้รับอนุมัติจากผู้ใช้เป็นลายลักษณ์อักษรในแชต

## 2. DESIGN.md และ tokens

- [x] 2.1 เขียน `Web/DESIGN.md`: หลักการ, น้ำเสียงข้อความไทย, ความหนาแน่น, กลุ่มสีสถานะ, typography — ตรวจว่าทุก decision ใน design D3–D5 อยู่ในเอกสาร
- [x] 2.2 `Web/src/styles/tokens.css` (primitive + semantic) และ map เข้า Tailwind พร้อมตั้ง Sarabun ผ่าน `next/font` — ตรวจด้วยภาพหน้าจอที่ตัวเลข "1,234.50 / 98,765.25" จุดทศนิยมตรงกัน และสระไทยไม่ชนกันที่ line-height ที่กำหนด
- [x] 2.3 สคริปต์ตรวจ contrast ทุกคู่สี semantic ข้อความ/พื้น — ตรวจด้วย `pnpm test:contrast` ที่ทุกคู่ ≥ 4.5:1 (ข้อความใหญ่ ≥ 3:1)

## 3. Component พื้นฐาน (ต้องเสร็จก่อนงานหน้าจอของ foundations)

- [x] 3.1 Button, TextField, Select, Toast, ConfirmDialog (บังคับเหตุผลเมื่อเป็นการปฏิเสธ) บน Radix — ตรวจด้วย unit test ของ state ทุกแบบ และกรณีกดยืนยันการปฏิเสธไม่ได้เมื่อเหตุผลว่าง
- [x] 3.2 StatusBadge (11 สถานะ: ข้อความไทย + ไอคอน + สี) และ ConfidenceBadge (3 ระดับ + %) — ตรวจด้วย unit test ว่าทุกสถานะมี label/icon ไม่ซ้ำกัน และ snapshot แบบ grayscale แยกสถานะได้
- [x] 3.3 AmountField และฟังก์ชันจัดรูปแบบเงิน/วันที่ พ.ศ. — ตรวจด้วย unit test: "1500.555" ขึ้นข้อผิดพลาด, วาง "12,345.60" ได้ 12345.60, ติดลบแสดงเครื่องหมายลบ, 2026-10-29 แสดงเป็น "29/10/2569"
- [x] 3.4 Dropzone (หลายไฟล์, ผลรายไฟล์), EmptyState, ErrorState (มีปุ่มลองใหม่), Skeleton — ตรวจด้วย unit test และใช้งานด้วยคีย์บอร์ดได้
- [x] 3.5 AppShell พร้อมเมนูตาม role และข้อความ UI ใน `src/i18n/th.ts` — ตรวจด้วย unit test ว่าเมนูของแต่ละ role ตรงกับ permission matrix
- [x] 3.6 หน้า `/dev/components` แสดงทุก component ทุก state และ Playwright + axe — ตรวจด้วย test ที่ไม่มีปัญหาระดับ serious/critical และหน้านี้ไม่อยู่ใน production build

## 4. Component สำหรับ Phase 2

- [ ] 4.1 DataTable (ตัวเลขชิดขวา, แถว 40 px, sticky header, เน้นแถว/ช่อง confidence ต่ำ) — ตรวจด้วย Playwright ว่าแสดงอย่างน้อย 8 แถวในพื้นที่ split-view บนจอ 1366×768 และ 12 แถวขึ้นไปบน 1920×1080
- [ ] 4.2 BBoxOverlay บน PDF.js รับพิกัดสัดส่วน 0–1 และไฮไลต์เมื่อ focus field ที่คู่กัน — ตรวจด้วย Playwright ว่ากรอบอยู่ตำแหน่งเดิมเมื่อซูม 100% และ 200%
- [ ] 4.3 Layout split-view แบบตอบสนอง: ≥1280 px สองฝั่ง, น้อยกว่านั้นสลับแท็บ — ตรวจด้วย Playwright ที่ 1366×768, 1920×1080, 1024 และ 390 px

## 5. ตรวจรับ

- [ ] 5.1 รัน Impeccable `audit` และ `critique` บนหน้า `/dev/components` และ wireframe แล้วแก้จุดที่พบ — ตรวจว่าไม่มีประเด็นระดับสูงค้างอยู่
- [ ] 5.2 ตรวจ requirement ใน spec `ui-design-system` ครบทุกข้อเทียบกับหน้า `/dev/components` — บันทึกผลไว้ที่ `qa/phase1/design-system-check.md` (repo หลัก)

## Workflow follow-up

- รีวิวกับผู้ใช้ แล้ว archive change นี้ด้วย `/opsx:archive`
