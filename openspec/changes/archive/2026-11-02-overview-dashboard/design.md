# Design

## Context

ดูเหตุผลใน proposal.md ข้อจำกัดจากโค้ดปัจจุบันที่กำหนดแนวทาง:
- `GET /ops/overview` (`ops.view`) นับเอกสารตามสถานะด้วย `groupBy` และอ่านจำนวนงานในคิว BullMQ, การเชื่อมต่อ ERP และ `max(synced_at)` อยู่แล้ว
- `ReportsController.process()` คำนวณเวลาเฉลี่ยแต่ละขั้น สัดส่วนที่ต้องอนุมัติ และสัดส่วนที่ไม่ต้องแก้ค่า ด้วย join + group ครั้งเดียว (ปรับให้เร็วแล้วใน task 4.4 ของ change ก่อน) ส่วน `build()` คำนวณยอดเงินรายเดือนจากชุดสถานะ `counted`
- `system_logs` มี index `(level, service, created_at)` และ `api_keys` มี `expires_at`, `revoked_at`
- บัญชีของ API key ได้เฉพาะ permission ตามขอบเขตของ key (`document.upload`/`document.view`) และ route ที่ไม่มี permission ถูกปฏิเสธ (fix 3f020a3) ดังนั้น endpoint ใหม่ต้องมี permission ของตัวเอง
- เว็บ: `homeFor()` ใน `lib/auth/home.ts` เลือกหน้าแรก, `app/page.tsx` redirect ไป `/documents`, หน้า `/admin/sync` ดึงข้อมูลใหม่ทุก 30 วินาทีด้วย `setInterval`, คิวเอกสารเก็บแท็บใน state (`QUEUE_TABS`: waiting, approval, progress, failed, done) และหน้า `/admin/logs` ยังไม่อ่านตัวกรองจาก URL
- ไม่มี library กราฟ หน้ารายงานใช้แท่งแนวนอนแบบ CSS

## Goals / Non-Goals

**Goals:**
- เรียก API ครั้งเดียวต่อการโหลด/รีเฟรชหนึ่งรอบ และตอบภายใน 1 วินาทีบนฐาน perf (`sdes_perf`, 42,000 ฉบับ)
- ตัวเลขที่ซ้ำกับหน้ารายงานและหน้าติดตาม มาจากโค้ดคำนวณชุดเดียวกัน จึงไม่ขัดกัน
- การตรวจสิทธิ์ทำที่ server ต่อส่วน ไม่พึ่งการซ่อนบนเว็บ

**Non-Goals:**
- ตาราง/materialized view สำหรับสรุปผล, cache ข้ามคำขอ (Phase 4 พิจารณาถ้าวัดแล้วช้า)
- WebSocket push, การตั้งค่าการ์ดรายผู้ใช้

## Decisions

### D1. Endpoint เดียว `GET /dashboard` ประกอบส่วนตามสิทธิ์
- สิทธิ์ `dashboard.view` (ทุก role) ที่ระดับ endpoint แล้วตรวจ `can(roles, ...)` ต่อส่วน: `document.view` → `backlog`, `throughput`, `indicators`; `report.view` → `finance`; `ops.view` → `health`; `logs.view` → `health.errors24h`; `apikey.manage` → `health.expiringKeys` ส่วนที่ไม่มีสิทธิ์ไม่มี key ใน JSON เลย (ไม่ใช่ `null`) และไม่ถูก query
- ทุกส่วนที่มีสิทธิ์ query พร้อมกันด้วย `Promise.all`
- ทางเลือกที่ไม่เลือก: endpoint แยกต่อส่วน — เว็บต้องยิงหลายคำขอทุก 30 วินาที และต้องจัดการสถานะโหลด/ผิดพลาดหลายชุด; ใช้ `/ops/overview` + `/reports/summary` เดิมตรง ๆ — ได้ข้อมูลเกินและ Clerk เรียกไม่ได้
- รูปผลลัพธ์:
  ```
  { generatedAt,
    backlog?: { waiting|failed|reading|approval|syncFailed: { count, oldestAt } },
    throughput?: { days: [{ date: "YYYY-MM-DD", uploaded, verified, synced }] /* 14 แถว */ },
    indicators?: { windowDays: 7, avgSecondsToExtracted, noEditRate, approvalRate, targets: { seconds: 30, noEditRate: 0.92 } },
    finance?: { month: "YYYY-MM", current: Money, previous: Money },
    health?: { queues: { extract, sync }, syncFailed, connected, autoSync, lastSyncedAt, errors24h?, expiringKeys?: [{ id, name, expiresAt }] } }
  ```

### D2. ใช้โค้ดคำนวณร่วมกับรายงานและหน้าติดตาม
- ย้าย `process()` และการคำนวณยอดเงินจาก `reports.controller.ts` ไปเป็น `ReportMetrics` (provider ใน `reports/`) ที่รับช่วงเวลา `[start, end)` แล้วให้ทั้ง `ReportsController` และ `DashboardService` เรียก — test เดิมของรายงานต้องผ่านโดยไม่แก้
- ย้ายการอ่านคิว/การเชื่อมต่อของ `ops/overview` เป็นฟังก์ชันใน `OpsService` ใช้ร่วมกัน
- indicators = `ReportMetrics.process()` ช่วง 7 วันล่าสุด (เวลาไทย) และ finance = ยอดเงินของเดือนปัจจุบันและเดือนก่อน จึงตรงกับหน้ารายงานโดยโครงสร้าง (spec Finance snapshot)

### D3. งานค้างและแนวโน้มใน SQL เดียวต่อส่วน
- **backlog:** `SELECT status, count(*), min(updated_at) FROM documents WHERE status IN (...) GROUP BY status` ใช้ index `(status, created_at)`; `oldestAt` ใช้ `updated_at` (เวลาที่เข้าสถานะล่าสุด — ทุก transition อัปเดต `updated_at`) แทนการ join ประวัติ แล้วรวม `UPLOADED`+`PROCESSING` เป็น `reading`
- **throughput:** `generate_series` 14 วันตามเวลาไทย LEFT JOIN กับ (1) `documents.created_at` และ (2) `min(document_status_history.created_at)` ต่อเอกสารที่ `to_status` เป็น `VERIFIED`/`SYNCED` โดยกรองช่วง 14 วันก่อน group — ถ้าวัดแล้วเกิน 300 ms ที่ฐาน perf ให้เพิ่ม index `document_status_history (to_status, created_at)`
- ขอบวันใช้ `AT TIME ZONE 'Asia/Bangkok'` เหมือนรายงาน

### D4. สุขภาพระบบ
- `errors24h`: `count(*) FROM system_logs WHERE level = 'error' AND created_at > now() - interval '24 hours'`
- `expiringKeys`: `api_keys` ที่ `revoked_at IS NULL AND expires_at BETWEEN now() AND now() + 14 days` เรียงตาม `expires_at`
- `syncFailed` มาจาก count ของ backlog ถ้าคำนวณแล้ว ไม่ query ซ้ำ

### D5. Web
- `app/page.tsx` เป็นหน้าภาพรวม (client component ใน `AppFrame` ที่อนุญาตทุก role); `homeFor()` คืน `/` ทุก role; เมนู "ภาพรวม" (`/`) เป็นรายการแรกของทุก role ใน `lib/roles.ts`
- โหลดครั้งแรก + `setInterval` 30 วินาทีแบบเดียวกับ `/admin/sync`; หยุดเมื่อแท็บถูกซ่อน (`visibilitychange`) แล้วดึงทันทีเมื่อกลับมา; รอบที่ล้มเหลวคงข้อมูลเดิมและแสดงแถบ "ข้อมูลอาจไม่เป็นปัจจุบัน" พร้อมเวลา `generatedAt` ล่าสุด
- เลย์เอาต์ที่ 1366×768: แถวการ์ดงานค้าง (ตัวเลขใหญ่ + "เก่าสุด …" แบบเวลาสัมพัทธ์ภาษาไทย) → สองคอลัมน์: แนวโน้ม 14 วัน (แท่งแนวตั้ง SVG แบบเรียบสามชุด พร้อมตารางตัวเลขสำหรับ screen reader) | ตัวชี้วัด 3 ตัว (ค่า + เป้า + ป้ายผ่าน/ไม่ผ่าน) → แถวการเงิน → แถวสุขภาพระบบ; ใช้ `Panel` และ token สีจาก DESIGN.md (แดง stamp ใช้กับสถานะไม่ผ่าน/ล้มเหลวเท่านั้น) ไม่เพิ่ม library กราฟ
- ลิงก์: waiting → `/documents?tab=waiting`, reading → `?tab=progress`, failed/syncFailed → `?tab=failed` (ผู้ที่มี `ops.view` แต่ดูเอกสารไม่ได้ → `/admin/sync`), approval → `/approvals` ถ้ามี `document.approve` ไม่งั้น `?tab=approval`, finance → `/reports`, errors → `/admin/logs?level=error`
- คิวเอกสารอ่าน `?tab=` ตอนเริ่ม (ค่าที่ไม่รู้จักใช้แท็บแรก) และอัปเดต URL เมื่อเปลี่ยนแท็บด้วย `router.replace`; หน้า `/admin/logs` อ่าน `level`, `service`, `q` จาก URL เป็นค่าเริ่มของตัวกรอง

## Risks / Trade-offs

- [query ทุก 30 วินาทีต่อผู้ใช้ที่เปิดหน้าค้าง] → ทุกส่วนเป็น aggregate ที่มี index และหยุดเมื่อแท็บถูกซ่อน; ปริมาณผู้ใช้ตาม BRD (ไม่เกิน 50 คนพร้อมกัน) = ไม่เกิน ~2 คำขอต่อวินาที; Phase 4 เพิ่ม cache สั้น ๆ ถ้าวัดแล้วจำเป็น
- [`updated_at` เปลี่ยนเมื่อมีการบันทึก field ระหว่างรอตรวจ ทำให้ "เก่าสุด" ดูใหม่กว่าความจริง] → ยอมรับสำหรับภาพรวม; ถ้ารีวิวต้องการความแม่นยำค่อยใช้ประวัติสถานะ
- [สัดส่วน "ไม่ต้องแก้ค่า" เป็นตัวแทนความแม่นยำ ไม่ใช่ค่าความแม่นยำระดับบรรทัดที่ BRD วัด] → ป้ายบนหน้าจอเขียนว่า "ไม่ต้องแก้ค่าที่ AI อ่าน" ไม่เรียกว่าความแม่นยำ; การวัดจริงอยู่ในการทดสอบตาม BRD หลัง Phase 4
- [ย้ายโค้ดรายงานแล้วตัวเลขเปลี่ยนโดยไม่ตั้งใจ] → test ของรายงานเดิมต้องผ่านโดยไม่แก้ + test ใหม่ว่ายอดการเงินในหน้าภาพรวมเท่ากับ `/reports/summary` ของเดือนเดียวกัน

## Migration Plan

- ไม่มี migration ของข้อมูล (ยกเว้น index ใน D3 ถ้าวัดแล้วจำเป็น ซึ่งเป็น additive); permission ใหม่อยู่ในโค้ด
- rollback = คืน `homeFor()` และ `app/page.tsx` เดิม; endpoint ใหม่ไม่ถูกอ้างโดยของเดิม
