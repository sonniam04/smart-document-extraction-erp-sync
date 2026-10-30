# audit-trail Specification

## Purpose

บันทึกทุกการกระทำสำคัญและทุกการแก้ไขข้อมูลในระบบแบบแก้ไขหรือลบไม่ได้ เพื่อป้องกันการทุจริตและรองรับการตรวจสอบย้อนหลัง 100% ตาม BRD NFR Traceability & Audit

## Requirements

### Requirement: Audited events
ระบบ SHALL บันทึก audit event สำหรับ: การล็อกอินสำเร็จ/ล้มเหลว/ถูกล็อก, การจัดการผู้ใช้และ role, การเปลี่ยนการตั้งค่าระบบ, การอัปโหลด (รับ/ปฏิเสธพร้อมเหตุผล), การเปลี่ยนสถานะเอกสาร, การแก้ไข field ของข้อมูลเอกสาร และการเปิดดูไฟล์ต้นฉบับ

#### Scenario: อัปโหลดถูกปฏิเสธ
- **WHEN** ไฟล์ถูกปฏิเสธเพราะตรวจพบมัลแวร์
- **THEN** มี audit event ระบุผู้อัปโหลด ชื่อไฟล์ hash และเหตุผลการปฏิเสธ

#### Scenario: เปิดดูไฟล์ต้นฉบับ
- **WHEN** ผู้ใช้ขอลิงก์ดูไฟล์ต้นฉบับ
- **THEN** มี audit event ระบุผู้ใช้ เอกสาร และเวลา

### Requirement: Event content
Audit event แต่ละรายการ SHALL มี: ผู้กระทำ (ผู้ใช้หรือระบบ), ประเภทการกระทำ, สิ่งที่ถูกกระทำ (ประเภทและรหัส), เวลาจาก server, IP ต้นทาง (ถ้ามาจากผู้ใช้) และสำหรับการแก้ไขข้อมูล MUST มีชื่อ field ค่าก่อนแก้ และค่าหลังแก้

#### Scenario: แก้ยอดเงิน
- **WHEN** AP Clerk แก้ field `grand_total` จาก 10,700.00 เป็น 10,770.00
- **THEN** audit event บันทึกผู้แก้, เวลา, field `grand_total`, ค่าก่อน 10,700.00 และค่าหลัง 10,770.00

### Requirement: Immutability
Audit event SHALL แก้ไขหรือลบไม่ได้โดยผู้ใช้ทุก role รวมถึง System Admin และ MUST ถูกป้องกันที่ระดับฐานข้อมูล ไม่ใช่เฉพาะที่ระดับแอปพลิเคชัน

#### Scenario: พยายามลบผ่านฐานข้อมูล
- **WHEN** มีการสั่ง UPDATE หรือ DELETE ตาราง audit โดยตรงด้วยบัญชีฐานข้อมูลที่แอปพลิเคชันใช้
- **THEN** ฐานข้อมูลปฏิเสธคำสั่ง และข้อมูลเดิมยังอยู่ครบ

#### Scenario: ไม่มี API ลบ
- **WHEN** ผู้ใช้ role ใดก็ตามเรียก API เพื่อแก้หรือลบ audit event
- **THEN** ไม่มี endpoint ให้ทำได้ (405/404)

### Requirement: Atomic recording
การกระทำที่ต้องบันทึก audit SHALL สำเร็จก็ต่อเมื่อบันทึก audit สำเร็จด้วย หากบันทึก audit ไม่ได้ การกระทำนั้น MUST ไม่มีผล

#### Scenario: บันทึก audit ล้มเหลว
- **WHEN** การบันทึก audit ของการแก้ field ล้มเหลว
- **THEN** ค่าของ field ไม่ถูกเปลี่ยน และผู้ใช้ได้รับแจ้งข้อผิดพลาด

### Requirement: Audit access
ผู้ใช้ role `FINANCE_EXEC` และ `SYS_ADMIN` SHALL ค้นหาและดู audit trail ได้ โดยกรองตามช่วงเวลา ผู้กระทำ ประเภทการกระทำ และเอกสาร role อื่น MUST ดูได้เฉพาะประวัติของเอกสารที่ตนมีสิทธิ์ดู

#### Scenario: Exec ค้นการแก้ไขของผู้ใช้
- **WHEN** Finance Exec กรอง audit trail ตามผู้ใช้หนึ่งคนในช่วง 7 วัน
- **THEN** ระบบแสดงทุก event ของผู้ใช้นั้นในช่วงดังกล่าว เรียงจากใหม่ไปเก่า

#### Scenario: Clerk ดู audit ทั้งระบบ
- **WHEN** ผู้ใช้ที่มีเพียง role `AP_CLERK` เรียก API ค้นหา audit ทั้งระบบ
- **THEN** ระบบตอบกลับ 403

### Requirement: Sensitive data masking in audit
Audit event SHALL ไม่เก็บรหัสผ่าน, token หรือ secret ใด ๆ และ MUST mask เลขบัตรประชาชนและเลขบัญชีธนาคารส่วนบุคคลที่ไม่เกี่ยวกับภาษี (BRD NFR Security & PDPA)

#### Scenario: รีเซ็ตรหัสผ่าน
- **WHEN** System Admin รีเซ็ตรหัสผ่านผู้ใช้
- **THEN** audit event บันทึกว่ามีการรีเซ็ต แต่ไม่มีรหัสผ่านทั้งก่อนและหลังอยู่ในข้อมูล

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
