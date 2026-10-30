# Spec Delta

## ADDED Requirements

### Requirement: Audit trail viewer
หน้า Audit trail SHALL ให้ `FINANCE_EXEC` และ `SYS_ADMIN` ค้นหาตามช่วงเวลา ผู้กระทำ ประเภทการกระทำ และเลขเอกสาร แสดงผลเรียงจากใหม่ไปเก่าแบบแบ่งหน้า พร้อมรายละเอียดค่าก่อน/หลัง และ MUST ไม่มีปุ่มแก้หรือลบ

#### Scenario: ค้นประวัติของเอกสาร
- **WHEN** Finance Exec ค้นด้วยเลขเอกสาร DOC-000120
- **THEN** เห็นทุก event ของเอกสารนั้น รวมการแก้ field พร้อมค่าก่อน/หลัง การอนุมัติ และการส่งเข้า ERP

#### Scenario: Clerk เปิดหน้า Audit trail
- **WHEN** ผู้ใช้ที่มีเพียง role `AP_CLERK` เปิดหน้า Audit trail
- **THEN** ไม่เห็นเมนู และหน้าแจ้งว่าไม่มีสิทธิ์

### Requirement: Audit export
ผู้ใช้ที่ดู audit trail ได้ SHALL ส่งออกผลการค้นหาปัจจุบันเป็น CSV (UTF-8 พร้อม BOM ให้เปิดใน Excel ภาษาไทยได้) ไม่เกิน 50,000 แถวต่อครั้ง และการส่งออก MUST มี audit event ระบุผู้ส่งออกและเงื่อนไขการค้นหา

#### Scenario: ส่งออกการแก้ไขของเดือน
- **WHEN** System Admin ค้นการแก้ field ของเดือนตุลาคมแล้วกดส่งออก
- **THEN** ได้ไฟล์ CSV ที่เปิดใน Excel แล้วภาษาไทยถูกต้อง และมี audit event ของการส่งออกนี้
