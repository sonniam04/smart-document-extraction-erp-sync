# platform-security Specification

## Purpose

ป้องกันระบบในระดับแพลตฟอร์มให้ผ่านเกณฑ์ตรวจรับของ BRD (ไม่มีช่องโหว่ระดับ Critical) และให้การควบคุมสิทธิ์ตาม role ถูกตรวจอัตโนมัติทุกครั้งที่แก้โค้ด

## Requirements

### Requirement: Rate limiting
API SHALL จำกัดอัตราการเรียกต่อ IP สำหรับการล็อกอินและการขอ token ใหม่ (ไม่เกิน 10 ครั้งต่อนาที) และต่อผู้ใช้สำหรับการอัปโหลด (ไม่เกิน 60 คำขอต่อนาที) คำขอที่เกิน MUST ได้ 429 พร้อมเวลาที่ลองใหม่ได้ และไม่ไปถึงการตรวจรหัสผ่าน

#### Scenario: ยิงล็อกอินรัว
- **WHEN** IP เดียวส่งคำขอล็อกอิน 11 ครั้งภายใน 1 นาที
- **THEN** คำขอที่ 11 ได้ 429 พร้อม header `Retry-After`

### Requirement: Security headers
ทุกคำตอบของ API และเว็บ SHALL มี security headers: `Strict-Transport-Security` (เมื่อใช้ HTTPS), `X-Content-Type-Options: nosniff`, `Referrer-Policy`, การกัน frame (`frame-ancestors` หรือ `X-Frame-Options`) และ Content-Security-Policy ของเว็บที่อนุญาตเฉพาะต้นทางที่ระบบใช้

#### Scenario: ตรวจ header ของหน้าเว็บ
- **WHEN** เปิดหน้า `/login`
- **THEN** คำตอบมี Content-Security-Policy, `X-Content-Type-Options: nosniff` และห้ามฝังหน้าใน frame ของเว็บอื่น

### Requirement: Dependency vulnerability gate
CI ของทั้งสอง repo SHALL สแกน dependency ที่ใช้งานจริงหาช่องโหว่ทุกครั้ง และ MUST ไม่ผ่านเมื่อพบช่องโหว่ระดับ critical ที่ยังไม่ได้ยกเว้นพร้อมเหตุผลเป็นลายลักษณ์อักษร

#### Scenario: dependency มีช่องโหว่ critical
- **WHEN** มี dependency ที่ใช้งานจริงมีช่องโหว่ระดับ critical และไม่มีรายการยกเว้น
- **THEN** CI ไม่ผ่านพร้อมระบุแพ็กเกจและช่องโหว่

### Requirement: Authorization regression test
ระบบ SHALL มี test อัตโนมัติที่เรียกทุก endpoint ที่ต้องล็อกอินด้วยผู้ใช้ทุก role และยืนยันว่าผลอนุญาต/ปฏิเสธตรงกับ permission matrix และ endpoint ใหม่ที่ไม่ได้ประกาศสิทธิ์ MUST ทำให้ test ไม่ผ่าน

#### Scenario: เพิ่ม endpoint โดยลืมกำหนดสิทธิ์
- **WHEN** นักพัฒนาเพิ่ม endpoint ที่ไม่ได้ระบุ permission
- **THEN** test ตรวจสิทธิ์ไม่ผ่านพร้อมชื่อ endpoint นั้น

#### Scenario: Clerk เรียก endpoint ของ Admin
- **WHEN** test เรียก endpoint ตั้งค่า ERP ด้วยผู้ใช้ `AP_CLERK`
- **THEN** ได้ 403 ตาม permission matrix
