# Spec Delta

## MODIFIED Requirements

### Requirement: Permission matrix
ระบบ SHALL อนุญาตการกระทำตาม role ดังนี้: `AP_CLERK` อัปโหลด ดู และแก้ข้อมูลเอกสาร และดูทะเบียนผู้ขาย; `AP_LEAD` ทำได้เท่า `AP_CLERK` และอนุมัติ/ปฏิเสธเคสเสี่ยง; `FINANCE_EXEC` ดูเอกสาร รายงาน และ audit trail แบบอ่านอย่างเดียว; `SYS_ADMIN` จัดการผู้ใช้ การตั้งค่าระบบ API keys และการเชื่อมต่อ ERP และดู system logs ทุก role SHALL เปิดหน้าภาพรวมได้ ส่วนบัญชีของ API key ไม่ได้รับสิทธิ์นี้ การกระทำที่ role ไม่มีสิทธิ์ MUST ถูกปฏิเสธที่ฝั่ง server

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

#### Scenario: ทุก role เปิดหน้าภาพรวม
- **WHEN** ผู้ใช้ที่มีเพียง role ใด role หนึ่งในสี่ role เรียกข้อมูลหน้าภาพรวม
- **THEN** ระบบตอบกลับสำเร็จ (200)
