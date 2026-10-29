# Design

## Context

Phase 1 (archive `2026-10-29-phase1-architecture-foundations`) ส่งมอบสิ่งที่ Phase 2 ต่อยอดได้ทันที:

- `packages/core` มี `ExtractionProvider`/`ExtractionResult`, permission matrix (มี `document.edit`, `document.verify`, `document.approve`, `settings.manage` แล้ว) และ state machine ที่มีเส้นทาง `EXTRACTED→VERIFIED→PENDING_APPROVAL→APPROVED/REJECTED` แล้ว
- `apps/worker/src/extract.ts` ทำ `UPLOADED→PROCESSING→EXTRACTED/FAILED` ด้วย BullMQ (`attempts: 3`, exponential backoff, `jobId` = document id) โดยใช้ `FakeExtractionProvider`
- ตาราง `documents` มี field ภาษีครบ (รวม `wht_base` แยก), `document_extractions` เก็บผลดิบรายรอบ, `vendors` (unique Tax ID + สาขา), `settings` (มี `risk.confidence_threshold`, `risk.high_amount_threshold`)
- `GET /documents/:id/file` คืน presigned URL อายุ 5 นาที และมี audit แล้ว
- Web มี component ของ split view, `AmountField`, `ConfidenceBadge`, `TextField`/`CellInput` จาก design system และ wireframe `Web/design/wireframes/review.html` ที่อนุมัติแล้ว พร้อมรายการส่งต่อ 7 ข้อใน `qa/phase1/design-system-check.md`

ข้อจำกัด: ยอดเงินใช้ `NUMERIC(18,2)`/`Decimal` เท่านั้น, worker กับ api ใช้กติกาชุดเดียวกันจาก `packages/core`, dev รันบน WSL docker ที่ RAM จำกัด

## Goals / Non-Goals

**Goals:**
- กฎตรวจข้อมูลและกฎความเสี่ยงเป็น pure function ใน `packages/core` ที่ api, worker และ web ใช้ร่วมกัน ผลตรงกันทุกที่
- เปลี่ยน AI provider หรือรุ่นโมเดลได้ด้วย config โดยไม่แตะโค้ดส่วนอื่น
- วัดความแม่นยำและเวลาได้ซ้ำด้วยคำสั่งเดียว ก่อนและหลังปรับ prompt

**Non-Goals:**
- Fine-tune โมเดล หรือโมเดลที่รันในเครื่อง
- แก้ไขภาพเอกสาร (หมุน ตัดขอบ ปรับคม) ก่อนส่งอ่าน — ประเมินอีกครั้งหลังเห็นผลชุดวัด
- เก็บข้อมูลที่ AI อ่านได้เป็นตารางรายการสินค้าแยก (ยังเก็บเป็น JSONB ตาม Phase 1)

## Decisions

### D1. `ClaudeExtractionProvider` ใน worker: ส่งไฟล์ตรงและบังคับ JSON ด้วย structured outputs
- ใช้ `@anthropic-ai/sdk` เรียก `client.messages.parse()` พร้อม `output_config.format` จาก zod schema (`zodOutputFormat`) จึงได้ JSON ที่ผ่าน schema เสมอ ไม่ต้องแกะข้อความเอง
- PDF ส่งเป็น content block `document` (base64) ทั้งไฟล์ ภาพ JPG/PNG ส่งเป็น `image` TIFF แปลงทุกหน้าเป็น PNG ด้วย `sharp` ก่อน (Claude ไม่รับ TIFF) ข้อจำกัดคำขอ 32 MB / 600 หน้า ใหญ่กว่าเพดาน 20 MB ของระบบ
- โมเดลตั้งด้วย `EXTRACTION_MODEL` ค่าเริ่มต้น `claude-opus-5-5` และ `EXTRACTION_EFFORT` ค่าเริ่มต้น `low` (งานอ่านเอกสารไม่ต้องคิดลึก และต้องทันเป้า <30 วินาที) ถ้าชุดวัดผลแสดงว่ารุ่นอื่นถูกกว่าและยังผ่านเกณฑ์ เปลี่ยนได้ด้วย env แต่การเลือกรุ่นที่ถูกกว่าให้ผู้ใช้ตัดสิน
- เปิด server-side fallback (`fallbacks: "default"` + beta `server-side-fallback-2026-07-01`) เพื่อให้คำขอที่ถูกปฏิเสธโดยตัวกรองความปลอดภัยถูกส่งต่อให้รุ่นสำรองในคำขอเดียว และตรวจ `stop_reason` ทุกครั้ง: `refusal`/`max_tokens` ถือเป็นความล้มเหลวถาวรของรอบนั้น
- timeout ต่อคำขอ 120 วินาที, SDK `maxRetries: 0` เพราะ retry อยู่ที่ BullMQ ชั้นเดียว (attempts 3 เดิม) จะได้ไม่ซ้อนกัน แยกข้อผิดพลาดเป็น `transient` (429, 5xx, timeout, connection) ที่ให้ BullMQ retry และ `permanent` (400, PDF ล็อก, refusal) ที่ทำ `FAILED` ทันทีด้วย `UnrecoverableError`
- **ทางเลือกที่ไม่เลือก:** OCR (Textract/Document AI) + LLM — ได้ bbox แม่นกว่าแต่มีสองบริการ, สองค่าใช้จ่าย และเวลาแฝงรวมสูงกว่า; tool use แทน structured outputs — รุ่นปัจจุบันไม่รับการบังคับเรียก tool และ structured outputs ตรงกับงานนี้กว่า

### D2. ขยาย `ExtractionResult` ให้ครบ field ของ spec
เพิ่มใน `header`: `buyerBranch`, `vatBase`, `vatRate`, `vatExempt`, `whtBase`, `whtRate`, `whtAmount`, `netPayable` และใน line item เพิ่ม `discount` ค่าเงินคืนเป็น string ทศนิยม (ไม่ใช่ number) เพื่อไม่ให้เสียความแม่นยำก่อนเข้า `Decimal` วันที่คืนเป็น `YYYY-MM-DD` แบบ ค.ศ. (prompt สั่งให้แปลง พ.ศ. เอง และ schema บังคับรูปแบบ) `FakeExtractionProvider` ปรับให้คืน field ใหม่ด้วย และเพิ่ม `FixtureExtractionProvider` ที่คืนเฉลยของชุดทดสอบ ใช้ใน E2E/CI โดยไม่เรียก API จริง

### D3. ความมั่นใจและตำแหน่ง
- ให้โมเดลคืน `confidence` ราย field (0–1) และ `bbox` แบบพิกัดสัดส่วนของหน้า (`page`, `x`, `y`, `w`, `h` ช่วง 0–1) จึงไม่ขึ้นกับความละเอียดภาพที่ API ย่อ
- ความมั่นใจรวม = ค่าต่ำสุดของ field ยอดเงินหลัก (ยอดก่อนภาษี, VAT, ยอดรวม, หัก ณ ที่จ่าย) คูณด้วยค่าเฉลี่ยของ field ที่เหลือ ตรงกับ spec ที่ห้ามสูงกว่า field เงินที่ต่ำที่สุด
- ความมั่นใจที่โมเดลรายงานเองอาจไม่สอดคล้องกับความถูกต้องจริง จึงลดความมั่นใจลงอัตโนมัติเมื่อค่าไม่ผ่านกฎตรวจที่เกี่ยวข้อง (เช่น ยอดรวมไม่ลงตัว → ลดความมั่นใจของ field ยอดที่เกี่ยวข้องเหลือไม่เกิน 0.5) และใช้ชุดวัดผลตรวจว่าเกณฑ์ 0.85 แยกค่าผิด/ถูกได้จริง
- **bbox ละเอียดขึ้นบนหน้าเว็บ:** PDF ที่มีชั้นข้อความ ให้ web ใช้ `getTextContent()` ของ PDF.js หาข้อความที่ตรงกับค่า field ภายในบริเวณใกล้ bbox ของ AI แล้วใช้ตำแหน่งนั้นแทน ส่วนภาพสแกนใช้ bbox ของ AI ตรง ๆ

### D4. กฎตรวจข้อมูลใน `packages/core/validation`
- `validateDocument(data, ctx) → ValidationIssue[]` โดย `ValidationIssue = { code, severity: 'ERROR'|'WARNING', message, fields: FieldPath[] }` และ `FieldPath` เช่น `header.grandTotal`, `items[2].amount`
- คำนวณด้วย `decimal.js` (Prisma `Decimal` ใช้ตัวเดียวกัน) ปัด 2 ตำแหน่งแบบ half-up และเทียบด้วย `abs(diff) <= 0.01`
- `ctx` มี `companyTaxId`, `uploadedAt` และ `duplicateDocNo` ที่ api/worker ค้นมาก่อนแล้วส่งเข้ามา (core ไม่แตะ DB และเป็น sync function จึงใช้ในเว็บได้)
- Tax ID: สูตร mod 11 ของเลขประจำตัวผู้เสียภาษี 13 หลัก (ผลรวมหลัก 1–12 คูณน้ำหนัก 13…2, หลักที่ 13 = (11 − sum mod 11) mod 10)
- ผลตรวจล่าสุดเก็บใน `documents.validation_issues` (jsonb ใหม่) เพื่อให้คิวแสดงจำนวนปัญหาได้โดยไม่คำนวณใหม่ และ web ใช้ฟังก์ชันเดียวกันคำนวณสดระหว่างพิมพ์
- **การแชร์ข้ามสอง repo:** โมดูล extraction/taxid/validation/risk/confidence ไม่มี dependency ฝั่ง Node (เหลือแค่ `zod`, `decimal.js`) และเว็บคัดลอกมาที่ `Web/src/lib/core/` ด้วย `pnpm sync:core` พร้อม test ของโมดูลเหล่านั้น จึงรัน test ชุดเดียวกันทั้งสองฝั่ง `pnpm sync:core --check` ใช้ตรวจว่าสำเนาไม่เพี้ยน (ต้องมี `Service/` อยู่ข้างกัน) เลือกแทนการ publish package เพราะ repo เป็น private และ CI ของแต่ละ repo เข้าถึงอีก repo ไม่ได้
- ตรวจซ้ำที่ฝั่ง server ทุกครั้งที่บันทึกและตอนยืนยัน ผลจาก web เป็นแค่ UX

### D5. Worker หลังอ่าน
`PROCESSING → EXTRACTED` ใน transaction เดียวกับ: บันทึก `document_extractions`, เขียนค่าที่อ่านได้ลง field ของ `documents`, เก็บ `items` + `field_meta` (ความมั่นใจ/bbox/ค่าที่ AI อ่าน ราย field) และ `validation_issues` แล้ว publish สถานะเดิมผ่าน Redis เวลาที่ใช้ (`duration_ms`) บันทึกใน `document_extractions` เพื่อรายงาน KPI

### D6. API ของการตรวจแก้และอนุมัติ
| Endpoint | สิทธิ์ | หมายเหตุ |
|---|---|---|
| `GET /documents/:id` (ขยาย) | `document.view` | คืนข้อมูล, `field_meta`, `validation_issues`, `risk_flags`, ประวัติสถานะ และประวัติการแก้ |
| `PATCH /documents/:id/data` | `document.edit` | body = `{ version, changes }` แก้เฉพาะ field ที่ส่งมา (รวมรายการทั้งชุดเมื่อแก้ items) ต้องอยู่ที่ `EXTRACTED`; `version` ไม่ตรง → 409 พร้อมข้อมูลล่าสุด; audit ต่อ field |
| `POST /documents/:id/verify` | `document.verify` | ตรวจซ้ำที่ server, มี `ERROR` → 422 พร้อมรายการ; สำเร็จ → `VERIFIED` + จับคู่/สร้าง vendor + ประเมินความเสี่ยง + `PENDING_APPROVAL` ถ้าเสี่ยง (transaction เดียว) คืน id ของเอกสารรอตรวจถัดไป |
| `GET /documents?status=PENDING_APPROVAL` | `document.approve` | คิวอนุมัติ เรียงเก่าไปใหม่ |
| `POST /documents/:id/approve` / `reject` | `document.approve` | reject ต้องมี `reason`; ตรวจการแยกหน้าที่ (D8) |
| `GET /documents/:id/file/content` | `document.view_file` | stream ไฟล์ผ่าน API ให้ PDF.js (เส้นทางเดียวกับ origin ของเว็บผ่าน rewrite จึงไม่ต้องตั้ง CORS ที่ S3) + audit การเปิด; TIFF ส่งเป็น PNG รายหน้า (`?page=N`) |
| `GET/PUT /settings/risk` | `settings.manage` | เกณฑ์ความมั่นใจ, ยอดสูง, Tax ID/ชื่อบริษัท ตรวจค่าก่อนบันทึก + audit ค่าก่อน/หลัง |

- `EXTRACTED→VERIFIED` เป็นการกระทำของผู้ใช้ ส่วน `VERIFIED→PENDING_APPROVAL` เป็นของระบบ (ตาม transition authority เดิม) ทั้งสองอยู่ใน transaction เดียวโดย actor ต่างกันในประวัติ
- ไม่ทำเส้นทาง `VERIFIED→SYNCING` ใน phase นี้ เอกสารไม่เสี่ยงคงอยู่ที่ `VERIFIED`

### D7. Migration ที่ต้องเพิ่ม
- `documents`: `validation_issues jsonb default '[]'`, `field_meta jsonb default '{}'`, `items jsonb default '[]'` (สำเนาที่แก้ได้ของรายการ — `document_extractions.items` เป็นค่าที่ AI อ่าน แก้ไม่ได้), `buyer_branch char(5)`, `vendor_branch char(5)`, `vendor_tax_id char(13)`, `vendor_name text`, `verified_by uuid`, `verified_at timestamptz`
- `document_extractions`: `duration_ms int`, `error text`
- partial unique index `(vendor_id, invoice_no) WHERE status NOT IN ('REJECTED','UPLOADED','PROCESSING','FAILED','EXTRACTED')` เป็นตาข่ายชั้นสุดท้ายกันเลขที่ซ้ำถูกยืนยันพร้อมกัน (กฎใน D4 แจ้งผู้ใช้ก่อน)
- settings ใหม่: `company.tax_id`, `company.name` (seed จาก env `COMPANY_TAX_ID`, `COMPANY_NAME`)

### D8. การแยกหน้าที่
ผู้ห้ามอนุมัติ = `verified_by` ∪ ผู้ใช้ที่มี audit `document.field_edited` ของเอกสารนั้น ตรวจใน transaction เดียวกับการเปลี่ยนสถานะ และคืน 403 พร้อมรหัส `SELF_APPROVAL` ให้ web แสดงเหตุผล ถ้าบริษัทมี AP Lead คนเดียว งานที่เขาแก้เองจะค้าง — บันทึกเป็นความเสี่ยงด้านล่าง

### D9. Web
- เส้นทาง `/documents/[id]` เป็นหน้าตรวจ (โหมด Clerk เมื่อ `EXTRACTED`, โหมดอนุมัติเมื่อ `PENDING_APPROVAL` และผู้ใช้มี `document.approve`, โหมดอ่านอย่างเดียวในกรณีอื่น) และ `/approvals` เป็นคิวอนุมัติ ทำตาม wireframe และปิดรายการส่งต่อ 7 ข้อ
- ตัวแสดงเอกสาร: `pdfjs-dist` วาดลง canvas ทีละหน้าแบบ lazy, ภาพ/TIFF แสดงเป็น `<img>` รายหน้า, กรอบไฮไลต์วางด้วยพิกัดสัดส่วนคูณขนาดหน้าที่แสดงจริง
- ฟอร์มเก็บ state ฝั่ง client, คำนวณผลตรวจสดด้วย core, บันทึกอัตโนมัติแบบ debounce 800 ms ผ่าน `PATCH` (ส่ง `version`) และแสดงสถานะ "บันทึกแล้ว/กำลังบันทึก/ข้อมูลถูกแก้โดยคนอื่น"
- คีย์ลัด J/K ไปรายการ "ต้องตรวจ" ถัดไป/ก่อนหน้า, Ctrl+Enter ยืนยัน
- ตัวอักษรสับสน (`0`/`O`, `1`/`l`) ในเลขที่เอกสารที่ความมั่นใจต่ำ: แสดงค่าด้วยฟอนต์ monospace ที่แยกตัวอักษรชัด (ตัดสินรายการส่งต่อข้อ 6) ไม่แก้ค่าให้อัตโนมัติ

### D10. ชุดวัดผล `qa/extraction-eval`
- สร้างใบกำกับภาษีไทยสังเคราะห์ ~30 ฉบับจาก template HTML หลายรูปแบบ (ฟอนต์ไทย, มี/ไม่มี WHT, หลายหน้า, ยกเว้น VAT, ภาพสแกนที่ใส่ noise/เอียง) render เป็น PDF/PNG/TIFF ด้วย Playwright พร้อมไฟล์เฉลย JSON ที่ได้จาก data ชุดเดียวกัน จึงเฉลยถูกเสมอ
- สคริปต์ `pnpm eval` เรียก provider จริงกับทุกไฟล์ แล้วรายงานความแม่นยำราย field, รายบรรทัด (ทุกช่องตรง), เวลาเฉลี่ย/p95 และค่าใช้จ่ายโดยประมาณจาก `usage` เขียนผลเป็น markdown ลง `qa/phase2/`
- การรันเรียก API จริงและมีค่าใช้จ่าย จึงรันด้วยมือ ไม่อยู่ใน CI; CI ใช้ `FixtureExtractionProvider`
- เอกสารจริงที่ปิดข้อมูลแล้ววางใน `qa/extraction-eval/private/` ที่อยู่ใน `.gitignore`

## Risks / Trade-offs

- [bbox จาก vision model ไม่แม่นระดับพิกเซล] → พิกัดสัดส่วน + ปรับด้วยชั้นข้อความ PDF.js (D3) และแสดงกรอบแบบมีระยะเผื่อ; วัดอัตรากรอบครอบค่าจริงในชุดวัดผล
- [ความมั่นใจที่โมเดลรายงานเองไม่สะท้อนความถูกต้อง] → ลดความมั่นใจตามผลกฎตรวจ (D3) และปรับจากชุดวัดผล; กฎตรวจยอดเป็นตาข่ายหลักเพราะเชื่อถือได้ 100%
- [เวลาแฝงของโมเดลใหญ่เกินเป้า 30 วินาทีกับเอกสารหลายหน้า] → effort `low`, วัด p95 ในชุดวัดผล, เปลี่ยนรุ่นได้ด้วย env; เป้าเป็นค่าเฉลี่ยของเอกสาร ≤5 หน้าตาม spec
- [ค่าใช้จ่าย API ต่อเดือน (~3,500 ฉบับ)] → รายงานค่าใช้จ่ายต่อฉบับจากชุดวัดผลให้ผู้ใช้ตัดสินรุ่น; ไม่อ่านซ้ำเมื่อไม่จำเป็น (jobId idempotent เดิม)
- [ส่งข้อมูลเอกสารให้ผู้ให้บริการภายนอก (PDPA)] → ใช้บัญชี API เชิงพาณิชย์ที่ไม่นำข้อมูลไปฝึก, ส่งเฉพาะไฟล์ (spec), บันทึกไว้ในเอกสารประเมิน PDPA ของ Phase 4
- [AP Lead คนเดียวอนุมัติงานที่ตัวเองแก้ไม่ได้] → ตั้งใจตาม spec; แจ้งผู้ใช้ให้มี AP Lead อย่างน้อย 2 คน หรือให้ Clerk เป็นคนแก้
- [PDF.js เพิ่มขนาด bundle] → โหลด worker ของ PDF.js แบบ dynamic import เฉพาะหน้าตรวจ
- [ไม่มี `ANTHROPIC_API_KEY` ในเครื่อง dev/CI] → `EXTRACTION_PROVIDER=fake|fixture` เป็นค่าเริ่มต้นใน dev/CI; provider `claude` ตรวจว่ามี key ตอนเริ่ม worker และหยุดพร้อมข้อความชัดเจนถ้าไม่มี

## Migration Plan

- Migration เพิ่ม column/index แบบ additive ทั้งหมด ไม่แตะข้อมูลเดิม เอกสาร `EXTRACTED` ที่อ่านด้วย fake provider ใน dev จะมีข้อมูลว่างและผลตรวจ `ERROR` ซึ่งถูกต้อง — กด "อ่านใหม่" ไม่ได้เพราะไม่ใช่ `FAILED` จึงล้างข้อมูล dev ด้วย `docker compose down -v` หลังเปลี่ยน provider
- เปิด provider จริงด้วย `EXTRACTION_PROVIDER=claude` + `ANTHROPIC_API_KEY` ใน `.env`; rollback คือสลับกลับเป็น `fake`
- Seed เพิ่ม `company.tax_id`/`company.name` จาก env ถ้ายังไม่มี

## Open Questions

- รุ่นโมเดลที่ใช้จริงใน production — ตัดสินจากผลชุดวัดผล (ความแม่นยำ เวลา ค่าใช้จ่าย) ปลาย Phase 2 เปลี่ยนได้ด้วย env ไม่กระทบโค้ด
- ค่าเริ่มต้นของ `risk.high_amount_threshold` — ยังรอฝ่ายบัญชี ระหว่างนี้กฎยอดสูงไม่ทำงาน (ตาม spec)
- Tax ID และชื่อบริษัทจริงสำหรับตั้งค่า — ใช้ค่าทดสอบใน dev จนกว่าจะได้รับ
