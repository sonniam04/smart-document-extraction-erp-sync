# Spec Delta

## MODIFIED Requirements

### Requirement: Permission matrix
ระบบ SHALL อนุญาตการกระทำตาม role ดังนี้: `AP_CLERK` อัปโหลด ดู และแก้ข้อมูลเอกสาร และดูทะเบียนผู้ขาย; `AP_LEAD` ทำได้เท่า `AP_CLERK` และอนุมัติ/ปฏิเสธเคสเสี่ยง; `FINANCE_EXEC` ดูเอกสาร รายงาน และ audit trail แบบอ่านอย่างเดียว; `SYS_ADMIN` จัดการผู้ใช้ การตั้งค่าระบบ API keys และการเชื่อมต่อ ERP และดู system logs การกระทำที่ role ไม่มีสิทธิ์ MUST ถูกปฏิเสธที่ฝั่ง server

#### Scenario: Finance Exec พยายามแก้ข้อมูล
- **WHEN** ผู้ใช้ที่มีเพียง role `FINANCE_EXEC` ส่งคำขอแก้ field ของเอกสาร
- **THEN** ระบบตอบกลับว่าไม่มีสิทธิ์ (403) และไม่มีข้อมูลใดถูกเปลี่ยน

#### Scenario: Clerk พยายามจัดการผู้ใช้
- **WHEN** ผู้ใช้ role `AP_CLERK` เรียก API สร้างผู้ใช้
- **THEN** ระบบตอบกลับ 403

#### Scenario: Admin ไม่ได้รับสิทธิ์งานบัญชีโดยอัตโนมัติ
- **WHEN** ผู้ใช้ที่มีเพียง role `SYS_ADMIN` พยายามอัปโหลดหรือแก้ข้อมูลเอกสาร
- **THEN** ระบบตอบกลับ 403

#### Scenario: Clerk ดู system logs
- **WHEN** ผู้ใช้ role `AP_CLERK` เรียก API ค้น system logs
- **THEN** ระบบตอบกลับ 403

## ADDED Requirements

### Requirement: Service accounts
บัญชีที่ระบบสร้างให้ API key แต่ละตัว SHALL ใช้ได้เฉพาะผ่าน API key นั้น บัญชีนี้ MUST ล็อกอินด้วยอีเมลและรหัสผ่านไม่ได้ และ MUST ไม่ปรากฏในรายการผู้ใช้ที่ System Admin จัดการ

#### Scenario: พยายามล็อกอินด้วยบัญชีของ key
- **WHEN** มีการล็อกอินด้วยอีเมลของบัญชีที่สร้างให้ API key
- **THEN** ระบบปฏิเสธด้วยข้อความเดียวกับรหัสผ่านผิด

#### Scenario: รายการผู้ใช้
- **WHEN** System Admin เปิดหน้าจัดการผู้ใช้หลังสร้าง API key แล้ว
- **THEN** ไม่เห็นบัญชีของ API key ในรายการ
