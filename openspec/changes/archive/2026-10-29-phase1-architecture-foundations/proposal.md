# Proposal

## Why

ฝ่ายบัญชีรับใบแจ้งหนี้/ใบกำกับภาษี/ใบเสร็จกว่า 3,500 ฉบับต่อเดือนจากคู่ค้ากว่า 200 ราย และยังต้องคีย์ข้อมูลเข้า ERP ด้วยมือ (ดู BRD `docs/Business Requirements Document & Terms of Reference.pdf`, TOR-BRD-ERP-01) ก่อนจะสร้าง AI extraction, การตรวจยอด และการ sync เข้า ERP ได้ ระบบต้องมีฐานที่มั่นคงก่อน ได้แก่ ตัวตนผู้ใช้และสิทธิ์ตาม role, การรับเอกสารเข้าระบบอย่างปลอดภัย, สถานะเอกสารที่ตรวจสอบย้อนหลังได้ และ audit trail ที่แก้ไขไม่ได้ Phase 1 (สัปดาห์ที่ 1–2) วางฐานนี้ให้ Phase 2–4 ต่อยอดโดยไม่ต้องรื้อ

## What Changes

- ตั้งโครง repo `sdes-service` (NestJS) และ `sdes-web` (Next.js) พร้อมสภาพแวดล้อม dev แบบ docker-compose (PostgreSQL 16, Redis, S3-compatible storage, ตัวสแกนไวรัส) และ CI บน GitHub Actions
- สร้าง data model หลัก: ผู้ใช้/role, เอกสาร, ผลการดึงข้อมูล (line items แบบ JSONB), ทะเบียนผู้ขาย, การตั้งค่าระบบ, ประวัติการ sync และ audit log
- ระบบล็อกอินในตัว (access + refresh token) และการควบคุมสิทธิ์ 4 role: `AP_CLERK`, `AP_LEAD`, `FINANCE_EXEC`, `SYS_ADMIN` พร้อมหน้าจัดการผู้ใช้สำหรับ Admin โครงสร้างพร้อมเพิ่ม OIDC/SSO ภายหลัง
- POC การรับเอกสารแบบครบเส้นทาง: อัปโหลดหลายไฟล์ → ตรวจชนิด/ขนาด → สแกนไวรัส → ตรวจไฟล์ซ้ำด้วย SHA256 → เก็บไฟล์ต้นฉบับ → เข้าคิวประมวลผล → แจ้งสถานะแบบ real-time
- กำหนด state machine ของเอกสารทั้งวงจร (UPLOADED → … → SYNCED/REJECTED/SYNC_FAILED) และบังคับให้เปลี่ยนสถานะได้เฉพาะเส้นทางที่อนุญาต
- Audit trail แบบ append-only บันทึกทุกการกระทำสำคัญและทุกการแก้ไข field (ใคร/อะไร/เมื่อไร/ค่าก่อน-หลัง)
- วาง interface สำหรับ AI extraction provider และ ERP adapter ให้สลับ provider ได้ (ยังไม่มี implementation จริง — อยู่ใน Phase 2–3)

นอกขอบเขต: การดึงข้อมูลด้วย AI จริง, กฎตรวจยอดคณิตศาสตร์/Tax ID, หน้าจอ split-view, risk check/การอนุมัติ, การ sync เข้า ERP, design system (แยกไปที่ change `phase1-design-system`)

## Capabilities

### New Capabilities
- `user-access`: การยืนยันตัวตนผู้ใช้, session, role 4 แบบ และสิทธิ์ที่แต่ละ role ทำได้ รวมถึงการจัดการบัญชีผู้ใช้โดย System Admin
- `document-ingestion`: การรับไฟล์เอกสารเข้าระบบ — ชนิด/ขนาดที่รองรับ, สแกนไวรัส, ตรวจไฟล์ซ้ำ, จัดเก็บต้นฉบับ, ส่งเข้าคิว และแจ้งความคืบหน้าให้ผู้ใช้
- `document-lifecycle`: สถานะของเอกสารและการเปลี่ยนสถานะที่อนุญาตตลอดวงจร ตั้งแต่อัปโหลดจนถึง sync หรือถูกปฏิเสธ
- `audit-trail`: บันทึกการกระทำและการแก้ไขข้อมูลแบบแก้ไข/ลบไม่ได้ และการเรียกดูโดย role ที่มีสิทธิ์

### Modified Capabilities
- (ไม่มี — ยังไม่มี spec เดิมในโปรเจกต์)

## Impact

- Repo `sonniam04/sdes-service` (โฟลเดอร์ `Service/`): โค้ดใหม่ทั้งหมด — API, worker, migration, docker-compose
- Repo `sonniam04/sdes-web` (โฟลเดอร์ `Web/`): โครง Next.js, หน้า login, หน้าจัดการผู้ใช้, หน้าอัปโหลด/คิว (ใช้ component จาก `phase1-design-system`)
- Dependencies ใหม่: PostgreSQL 16, Redis, S3-compatible storage (SeaweedFS ใน dev), ClamAV
- CI: GitHub Actions ในทั้งสอง repo
- สมมติฐาน: รันบน cloud และใช้ AI ผ่าน API (ตัดสินใจใน explore 2026-10-29); role matrix ตามตารางที่ผู้ใช้ให้เพิ่ม ซึ่งแทนที่ตารางใน BRD ข้อ 4
