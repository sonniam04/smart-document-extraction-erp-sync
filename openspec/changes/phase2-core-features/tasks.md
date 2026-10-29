# Tasks

> โค้ด service อยู่ใน `Service/` (repo `sdes-service`), โค้ด web อยู่ใน `Web/` (repo `sdes-web`), ชุดวัดผลและ E2E อยู่ใน `qa/` ของ repo หลัก แตก branch ใหม่จาก `main` ในแต่ละ repo การรันที่เรียก Claude API จริงมีค่าใช้จ่าย ต้องได้รับอนุมัติจากผู้ใช้ก่อนทุกครั้ง

## 1. Domain core: schema ผลการอ่านและกฎตรวจ (`packages/core`)

- [x] 1.1 ขยาย `ExtractionResult` ตาม design D2 (field หัวเอกสารที่ขาด, `discount` ของบรรทัด, เงินเป็น string ทศนิยม, วันที่ `YYYY-MM-DD`) พร้อม zod schema ที่ใช้ร่วมกับ structured outputs และปรับ `FakeExtractionProvider` — ตรวจด้วย unit test ว่า schema รับผลตัวอย่างที่ถูกต้องและปฏิเสธเงินที่เป็น number/วันที่ พ.ศ.
- [x] 1.2 ฟังก์ชัน Tax ID (mod 11) และรหัสสาขา 5 หลัก — ตรวจด้วย unit test ทั้งเลขถูก, หลักสุดท้ายผิด, ความยาวผิด, มีขีด/ช่องว่าง
- [x] 1.3 `validateDocument` ตาม design D4 ครอบคลุมทุก requirement ใน spec `invoice-validation` (ยอดรายการ, ชั้นที่ 1, VAT, ชั้นที่ 2, Tax ID, ผู้ซื้อ, เลขที่ซ้ำผ่าน `ctx`, field บังคับและวันที่) คำนวณด้วย `decimal.js` — ตรวจด้วย unit test ทุก scenario ใน spec รวมค่าขอบ 0.01/0.02
- [x] 1.4 `assessRisk` ตาม spec `risk-assessment` (ความมั่นใจ, ยอดสูงแบบไม่บังคับ, ผู้ขายใหม่, แก้ยอดเงิน, `WARNING` ค้าง) คืนเหตุผลพร้อมค่าเกณฑ์ ณ เวลาประเมิน — ตรวจด้วย unit test ทุก scenario
- [x] 1.5 ฟังก์ชันความมั่นใจรวมและการลดความมั่นใจตามผลกฎตรวจ (design D3) — ตรวจด้วย unit test ว่าความมั่นใจรวมไม่สูงกว่า field เงินที่ต่ำที่สุด
- [x] 1.6 ส่งออก validation/risk เป็น ESM ที่ไม่มี dependency ฝั่ง Node เพื่อให้ web import ได้ — ตรวจด้วย test ใน `Web/` ที่ import แล้วได้ผลเท่ากับ test ฝั่ง core

## 2. Data model (`packages/db`)

- [x] 2.1 Migration ตาม design D7 (column ใหม่ของ `documents` และ `document_extractions`, partial unique index `(vendor_id, invoice_no)`) — ตรวจด้วย integration test ว่า migrate บน DB ที่มีข้อมูล Phase 1 สำเร็จ และ insert เอกสาร `VERIFIED` เลขที่ซ้ำของผู้ขายเดียวกันถูกปฏิเสธ แต่ `REJECTED` ซ้ำได้
- [x] 2.2 Seed `company.tax_id`/`company.name` จาก env (`COMPANY_TAX_ID`, `COMPANY_NAME`) เพิ่มใน `.env.example` — ตรวจด้วย test ว่า seed รันซ้ำไม่ทับค่าที่ Admin แก้แล้ว
- [x] 2.3 อัปเดต `Service/docs/data-model.md` สำหรับ column ใหม่ — ตรวจว่าทุก column ใหม่มีคำอธิบาย

## 3. Claude extraction provider (`apps/worker`)

- [x] 3.1 เพิ่ม `@anthropic-ai/sdk` และ `ClaudeExtractionProvider` ตาม design D1 (PDF เป็น `document`, JPG/PNG เป็น `image`, `messages.parse` + `zodOutputFormat`, `EXTRACTION_MODEL`/`EXTRACTION_EFFORT`, server-side fallback, ตรวจ `stop_reason`) — ตรวจด้วย unit test ที่ mock client: สร้างคำขอถูกรูปแบบต่อชนิดไฟล์ และไม่มีข้อมูลผู้อัปโหลดในคำขอ
- [x] 3.2 แปลง TIFF หลายหน้าเป็น PNG ด้วย `sharp` ก่อนส่ง และตรวจ PDF ที่ล็อกรหัสผ่าน — ตรวจด้วย unit test กับไฟล์ตัวอย่าง TIFF 3 หน้า (ได้ 3 ภาพ) และ PDF ล็อก (ได้ข้อผิดพลาดถาวรพร้อมข้อความ "ไฟล์ PDF ถูกล็อกด้วยรหัสผ่าน")
- [x] 3.3 จำแนกข้อผิดพลาด transient/permanent, timeout 120 วินาที, SDK `maxRetries: 0` ให้ BullMQ retry ชั้นเดียว และ permanent ใช้ `UnrecoverableError` — ตรวจด้วย unit test: 429 แล้วสำเร็จ → `EXTRACTED`, ขัดข้อง 3 ครั้ง → `FAILED` พร้อมเหตุผล, 400 → `FAILED` ทันที
- [x] 3.4 `FixtureExtractionProvider` ที่คืนเฉลยตาม sha256 ของไฟล์ และเลือก provider ด้วย `EXTRACTION_PROVIDER=fake|fixture|claude` (claude ต้องมี `ANTHROPIC_API_KEY` ไม่เช่นนั้น worker หยุดพร้อมข้อความชัดเจน) — ตรวจด้วย test การเลือก provider และการเริ่ม worker โดยไม่มี key
- [x] 3.5 Worker หลังอ่านตาม design D5: เขียนข้อมูล, `items`, `field_meta`, `validation_issues`, `duration_ms` ใน transaction เดียวกับ `EXTRACTED` — ตรวจด้วย integration test ด้วย fixture provider ว่าเอกสารมีข้อมูลและผลตรวจครบ และการอ่านใหม่ไม่ลบผลรอบก่อน
- [x] 3.6 อัปเดต `Service/README.md` (env ใหม่, วิธีเปิด provider จริง, เรื่องข้อมูลที่ส่งออกไปภายนอก) — ตรวจว่า README มีตัวแปรใหม่ครบตาม `.env.example`

## 4. API: ตรวจแก้ ยืนยัน อนุมัติ ตั้งค่า (`apps/api`)

- [x] 4.1 ขยาย `GET /documents/:id` ให้คืน `field_meta`, `validation_issues`, `risk_flags`, ประวัติสถานะ และประวัติการแก้ — ตรวจด้วย e2e test ว่า `FINANCE_EXEC` อ่านได้และไม่มีข้อมูลต้องห้ามหลุด
- [x] 4.2 `PATCH /documents/:id/data` ตาม design D6 (เฉพาะ `EXTRACTED`, optimistic `version` → 409 พร้อมข้อมูลล่าสุด, ตรวจใหม่, audit ต่อ field พร้อมค่า AI/ก่อน/หลัง) — ตรวจด้วย e2e test ตาม scenario "สองคนแก้พร้อมกัน", "แก้หลังยืนยัน", "แก้เลขที่เอกสาร" และ `FINANCE_EXEC` ได้ 403
- [x] 4.3 `POST /documents/:id/verify` (ตรวจซ้ำ, `ERROR` → 422, จับคู่/สร้าง vendor, ประเมินความเสี่ยง, `VERIFIED` หรือ `PENDING_APPROVAL` ใน transaction เดียว, คืนเอกสารถัดไป) — ตรวจด้วย e2e test: มี ERROR ไม่เปลี่ยนสถานะ, ผู้ขายใหม่ → `PENDING_APPROVAL` + vendor ใหม่, เคสไม่เสี่ยงคงที่ `VERIFIED`, ประวัติมี actor ผู้ใช้และระบบ
- [x] 4.4 คิวอนุมัติ `GET /documents?status=PENDING_APPROVAL` และ `POST /documents/:id/approve|reject` พร้อมการแยกหน้าที่ (design D8) — ตรวจด้วย e2e test: อนุมัติ/ปฏิเสธสำเร็จ, reject ไม่มีเหตุผล → 400, ผู้ยืนยันหรือผู้แก้อนุมัติเอง → 403 `SELF_APPROVAL`, อนุมัติพร้อมกันสองคำขอ → 409 หนึ่งคำขอ
- [x] 4.5 `GET /documents/:id/file/content` stream ไฟล์ (TIFF เป็น PNG ราย `?page=N`) พร้อม audit การเปิด — ตรวจด้วย e2e test ว่าได้ไฟล์ถูกต้อง, `SYS_ADMIN` ได้ 403, และมี audit
- [x] 4.6 `GET/PUT /settings/risk` (ตรวจช่วงค่า, Tax ID บริษัทต้องผ่าน mod 11, audit ค่าก่อน/หลัง) — ตรวจด้วย e2e test ตาม scenario ใน spec `risk-assessment` รวม `AP_CLERK` ได้ 403
- [x] 4.7 Swagger ครบทุก endpoint ใหม่พร้อมตัวอย่าง — ตรวจด้วย test ว่า `/docs-json` มีทุก path ใหม่

## 5. Web: หน้าตรวจเอกสารแบบสองฝั่ง (`Web/`)

- [ ] 5.1 ตัวแสดงเอกสาร: `pdfjs-dist` (dynamic import, lazy ทีละหน้า, ซูม/เลื่อน), ภาพ/TIFF รายหน้า, กรอบไฮไลต์จากพิกัดสัดส่วน และปรับตำแหน่งด้วยชั้นข้อความ PDF (design D3) — ตรวจด้วย Vitest ของการแปลงพิกัด และ Playwright ว่าโฟกัส field หน้า 2 แล้วเลื่อนไปหน้า 2 พร้อมกรอบ
- [ ] 5.2 ฟอร์ม 4 หมวดตาม wireframe (Tax ID ช่องทีละหลัก 1-4-5-2-1, รายการสินค้าเพิ่ม/ลบ/แก้, สรุปยอดชั้น 1 และชั้น 2 พร้อมยอดจ่ายสุทธิ, ผลรวมรายการตรึงไว้) — ตรวจด้วย Playwright ที่ 1366×768 ว่าทุกหมวดแสดงและผลรวมไม่ถูกแถบปุ่มบัง
- [ ] 5.3 ผลตรวจสดด้วย core + แถบ "ต้องตรวจ" ที่คลิกไปที่ field ได้ + คีย์ลัด J/K + เน้น field ความมั่นใจต่ำและ field ที่ถูกแก้จากค่า AI — ตรวจด้วย Playwright: แก้ VAT แล้วรายการ "ยอดรวมไม่ตรง" หาย, J/K ย้ายโฟกัสตามลำดับ
- [ ] 5.4 บันทึกอัตโนมัติแบบ debounce พร้อม `version`, สถานะการบันทึก และการจัดการ 409 — ตรวจด้วย Playwright แบบสองแท็บว่าแท็บที่บันทึกทีหลังได้ข้อความและค่าล่าสุด
- [ ] 5.5 ยืนยัน: บรรทัด "หลังยืนยัน: …", กันยืนยันเมื่อมี ERROR, เปิดใบถัดไป และ toast พร้อมลิงก์กลับ — ตรวจด้วย Playwright ตาม scenario "ยืนยันขณะยังมี ERROR" และ "ยืนยันแล้วไปใบถัดไป"
- [ ] 5.6 จอแคบกว่า 1280 px: แท็บ "เอกสาร"/"ข้อมูล" เริ่มที่แท็บข้อมูล และกดที่ field แล้วสลับไปแท็บเอกสารพร้อมกรอบ (ตัดสินรายการส่งต่อข้อ 7) และแสดงเลขที่เอกสารความมั่นใจต่ำด้วยฟอนต์ที่แยก `0`/`O`, `1`/`l` (ข้อ 6) — ตรวจด้วย Playwright ที่ 1100 px
- [ ] 5.7 เชื่อมจากคิว `/documents` ไปหน้าตรวจ (คลิกแถว `EXTRACTED`) และแสดงจำนวนปัญหาในคิว — ตรวจด้วย Playwright

## 6. Web: อนุมัติและตั้งค่า (`Web/`)

- [ ] 6.1 หน้า `/approvals` คิวรออนุมัติพร้อมเหตุผลความเสี่ยง (เมนูแสดงเฉพาะผู้มี `document.approve`) — ตรวจด้วย Playwright ทั้ง AP Lead (เห็น) และ Clerk (ไม่เห็นเมนู)
- [ ] 6.2 โหมดอนุมัติในหน้าตรวจ: ฟอร์มอ่านอย่างเดียว, เหตุผลความเสี่ยง, ประวัติการแก้ (ค่า AI/ก่อน/หลัง, ผู้แก้), อนุมัติ/ปฏิเสธพร้อมกล่องยืนยันและเหตุผล, ข้อความเมื่ออนุมัติเองไม่ได้ — ตรวจด้วย Playwright ตาม scenario ใน spec `document-review`
- [ ] 6.3 หน้าตั้งค่าความเสี่ยงสำหรับ System Admin (เกณฑ์ความมั่นใจ, ยอดสูงด้วย `AmountField`, Tax ID/ชื่อบริษัท) — ตรวจด้วย Playwright: บันทึกค่าถูกต้องได้, 1.5 ถูกปฏิเสธพร้อมข้อความ
- [ ] 6.4 อัปเดต `Web/README.md` (หน้าใหม่, PDF.js worker) — ตรวจว่ามีส่วนอธิบายหน้าตรวจและหน้าอนุมัติ

## 7. ชุดวัดผลการอ่าน (`qa/extraction-eval`)

- [ ] 7.1 ตัวสร้างเอกสารสังเคราะห์ ~30 ฉบับตาม design D10 (หลาย template, มี/ไม่มี WHT, หลายหน้า, ยกเว้น VAT, สแกนมี noise/เอียง; ออกเป็น PDF/PNG/TIFF) พร้อมเฉลย JSON และ Tax ID ที่ผ่าน mod 11 — ตรวจด้วย script ที่รัน `validateDocument` กับเฉลยทุกฉบับแล้วไม่มี ERROR
- [ ] 7.2 สคริปต์ `pnpm eval` เรียก provider ที่เลือก รายงานความแม่นยำราย field/รายบรรทัด, เวลาเฉลี่ย/p95, ค่าใช้จ่ายโดยประมาณ และอัตรากรอบ bbox ครอบค่าจริง ลง `qa/phase2/extraction-eval.md` — ตรวจด้วยการรันกับ `fixture` provider แล้วได้ความแม่นยำ 100%
- [ ] 7.3 (ต้องได้อนุมัติค่าใช้จ่ายก่อน) รันชุดวัดผลกับ Claude provider จริง ปรับ prompt/schema จนความแม่นยำรายบรรทัด >92% และเวลาเฉลี่ย ≤30 วินาที — ตรวจด้วยรายงานใน `qa/phase2/extraction-eval.md` ที่แสดงตัวเลขผ่านเกณฑ์ และบันทึกรุ่น/effort ที่ใช้
- [ ] 7.4 ตรวจว่าเกณฑ์ความมั่นใจ 0.85 แยก field ที่อ่านผิดได้จากผลชุดวัด (สัดส่วน field ผิดที่ความมั่นใจ ≥0.85) และปรับการลดความมั่นใจตาม design D3 ถ้าจำเป็น — ตรวจด้วยตารางในรายงาน

## 8. Integration check

- [ ] 8.1 ขยาย E2E ใน `qa/e2e` (stack จริง, fixture provider): อัปโหลดเอกสารชุดทดสอบ → `EXTRACTED` → Clerk แก้ยอดที่ผิดตามรายการ "ต้องตรวจ" → ยืนยัน → เคสเสี่ยงเข้าคิว → AP Lead อีกคนอนุมัติ, เคสไม่เสี่ยงคงที่ `VERIFIED`, AP Lead ที่แก้เองอนุมัติไม่ได้ → Exec เห็น audit การแก้ field และการอนุมัติ — ตรวจด้วย Playwright ผ่าน 3 รอบติดกัน
- [ ] 8.2 (ต้องได้อนุมัติค่าใช้จ่ายก่อน) Smoke test กับ Claude provider จริง: อัปโหลดเอกสารสังเคราะห์ 5 ฉบับผ่านหน้าเว็บแล้วได้ `EXTRACTED` พร้อมข้อมูลและกรอบไฮไลต์ — ตรวจด้วยภาพหน้าจอใน `qa/phase2/evidence/`

## Workflow follow-up

- รีวิวผลกับผู้ใช้ (รวมรุ่นโมเดลและค่าใช้จ่ายต่อฉบับจากข้อ 7.3) แล้ว archive change นี้ด้วย `/opsx:archive`
